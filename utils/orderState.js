// 📁 utils/orderState.js

const orderState = new Map();

function startOrder(senderId, variant) {
  if (!variant?.id) return; // Ensure valid variant
  orderState.set(senderId, {
    step: 'need_name',
    variant,
    data: {}
  });
}

function get(senderId) {
  return orderState.get(senderId);
}

function advance(senderId, field, value) {
  const state = orderState.get(senderId);
  if (!state) return;
  state.data[field] = value;

  if (field === 'name')  state.step = 'need_phone';
  if (field === 'phone') state.step = 'need_address';
  if (field === 'address') state.step = 'ready';
}

function clear(senderId) {
  orderState.delete(senderId);
}

module.exports = { startOrder, get, advance, clear };
