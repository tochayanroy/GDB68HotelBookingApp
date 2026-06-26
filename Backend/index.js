const express = require('express');
const app = express();
const passport = require('passport');

const dotenv = require('dotenv');

const database = require('./config/Database');
require('./middleware/passport-jwt');
app.use(passport.initialize());

const userRoutes = require('./routes/userRoutes');
const hotelRoutes = require('./routes/hotelRoutes');
// const roomRoutes = require('./routes/roomRoutes');

app.use(express.json());
dotenv.config();

app.use('/users', userRoutes);
app.use('/hotels', hotelRoutes);
// app.use('/rooms', roomRoutes);

app.listen(process.env.PORT, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
});