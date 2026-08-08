const express = require('express');
require('dotenv').config();
const app = express();
app.use(express.json());
 
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
 
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));