const { MongoClient } = require('mongodb');
require('dotenv').config();

const client = new MongoClient(process.env.MONGO_URI);

async function fixFacebookDuplicates() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'moaawen');
    const usersCol = db.collection('users');

    console.log('🔍 Checking for duplicate Facebook connections...');

    // Find all users with Facebook IDs
    const fbUsers = await usersCol.find({ 
      facebookId: { $exists: true, $ne: null, $ne: '' } 
    }).toArray();
    
    console.log(`📊 Found ${fbUsers.length} users with Facebook connections`);

    // Group by Facebook ID to find duplicates
    const fbGroups = {};
    fbUsers.forEach(user => {
      if (!fbGroups[user.facebookId]) {
        fbGroups[user.facebookId] = [];
      }
      fbGroups[user.facebookId].push(user);
    });

    const duplicates = [];
    let totalFixed = 0;

    // Process duplicates
    for (const [fbId, users] of Object.entries(fbGroups)) {
      if (users.length > 1) {
        console.log(`\n⚠️ Found duplicate Facebook ID: ${fbId} (${users.length} users)`);
        
        duplicates.push({ facebookId: fbId, users: users.length });
        
        // Keep the user with password, or the oldest one
        const sortedUsers = users.sort((a, b) => {
          if (a.password && !b.password) return -1;
          if (!a.password && b.password) return 1;
          return new Date(a.createdAt) - new Date(b.createdAt);
        });

        const keepUser = sortedUsers[0];
        const removeUsers = sortedUsers.slice(1);

        console.log(`   ✅ Keeping Facebook connection for: ${keepUser.email}`);

        for (const user of removeUsers) {
          console.log(`   🔧 Removing Facebook connection from: ${user.email}`);
          
          await usersCol.updateOne(
            { _id: user._id },
            {
              $unset: {
                facebookId: '',
                facebookAccessToken: ''
              },
              $set: {
                updatedAt: new Date()
              }
            }
          );
          totalFixed++;
        }
      }
    }

    if (duplicates.length === 0) {
      console.log('✅ No duplicate Facebook connections found!');
    } else {
      console.log(`\n📋 Summary:`);
      console.log(`   - Duplicate Facebook IDs found: ${duplicates.length}`);
      console.log(`   - Users fixed: ${totalFixed}`);
      console.log(`   - Total users with Facebook connections: ${fbUsers.length - totalFixed}`);
    }

    // Now create the unique index to prevent future duplicates
    try {
      await usersCol.createIndex(
        { facebookId: 1 }, 
        { 
          unique: true, 
          sparse: true,
          name: 'unique_facebook_id'
        }
      );
      console.log('✅ Unique index on facebookId created successfully');
    } catch (indexError) {
      if (indexError.code === 11000) {
        console.log('📋 Unique index on facebookId already exists');
      } else {
        console.warn('⚠️ Could not create unique index:', indexError.message);
      }
    }

  } catch (error) {
    console.error('❌ Error fixing Facebook duplicates:', error);
  } finally {
    await client.close();
    console.log('\n🏁 Script completed');
  }
}

// Run the script
fixFacebookDuplicates();
