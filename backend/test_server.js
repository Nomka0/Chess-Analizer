import express from 'express';
const app = express();

console.log('Registering route...');
app.get('/api/models', (req, res) => {
  console.log('Route hit!');
  res.json(['test']);
});

console.log('Starting server...');
app.listen(3000, () => console.log('Server started on 3000'));

// Test after 500ms
setTimeout(async () => {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/models');
    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Response:', text);
  } catch (e) {
    console.log('Error:', e.message);
  }
  process.exit(0);
}, 500);