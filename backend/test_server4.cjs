const express = require('express');
const app = express();

console.log('Registering route...');
app.get('/api/models', (req, res) => {
  console.log('Route hit!');
  res.json(['test']);
});

console.log('Starting server...');
const server = app.listen(3000, '127.0.0.1', () => {
  console.log('Listen callback fired');
});

// Test after 2 seconds
setTimeout(async () => {
  try {
    const addr = server.address();
    console.log('Server address:', addr);
    const response = await fetch('http://127.0.0.1:3000/api/models');
    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Response:', text);
  } catch (e) {
    console.log('Error:', e.message);
  }
  process.exit(0);
}, 2000);