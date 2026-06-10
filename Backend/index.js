const express = require('express');
const app = express();

const dotenv = require('dotenv');

const database = require('./config/Database');

dotenv.config();

app.listen(process.env.PORT, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
});