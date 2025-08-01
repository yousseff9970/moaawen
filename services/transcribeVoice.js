const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const FormData = require('form-data');

const MAX_DURATION_SECONDS = 30;

// Utility: Download WhatsApp voice file
const downloadVoiceFile = async (url, filename, headers = {}) => {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    decompress: false, // Important for WhatsApp media
    headers
  });

  const filePath = path.join(__dirname, '..', 'tmp', filename);
  fs.writeFileSync(filePath, response.data);
  return filePath;
};

// Utility: Get audio duration in seconds
const getAudioDuration = async (filePath) => {
  const mm = await import('music-metadata');
  const metadata = await mm.parseFile(filePath);
  return metadata.format.duration;
};

// Transcribe with OpenAI Whisper
const transcribeWithWhisper = async (filePath) => {
  const duration = await getAudioDuration(filePath);
  if (duration > MAX_DURATION_SECONDS) return '__TOO_LONG__';

  const form = new FormData();
  form.append('file', createReadStream(filePath));
  form.append('model', 'gpt-4o-mini-transcribe');
  

  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...form.getHeaders()
    }
  });

  return response.data.text;
};

module.exports = {
  downloadVoiceFile,
  transcribeWithWhisper
};
