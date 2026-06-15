const express = require('express');
const app = express();

const dotenv = require('dotenv');

const database = require('./config/Database');

const userRoutes = require('./routes/userRoutes');


app.use(express.json());
dotenv.config();

app.use('/users', userRoutes);

app.listen(process.env.PORT, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
});