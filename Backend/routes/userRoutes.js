const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/UserSchema.js');
const Hotel = require('../models/HotelSchema.js')
const checkAdmin = require('../middleware/checkAdmin.js');
const checkSuperAdmin = require('../middleware/checkSuperAdmin.js');
const { uploadUserProfile, uploadUserProfileAlt, handleMulterError } = require('../middleware/multer.js');
const fs = require('fs');
const path = require('path');
const mongoose = require("mongoose");







const deleteImageFile = (imagePath) => {
    if (!imagePath) return false;

    try {
        // Extract filename from the path
        const filename = path.basename(imagePath);
        const fullPath = path.join(__dirname, '../uploads/profiles/', filename);

        // Check if file exists before deleting
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log(`Deleted image: ${fullPath}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting image file:', error);
        return false;
    }
};




////////////////////////////// User //////////////////////////////
////////////////////////////// User //////////////////////////////


// ==================== REGISTER USER ====================
router.post('/register', async (req, res) => {
    try {

        const { Name, email, password, phone } = req.body;

        const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists with this email or phone' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = new User({
            Name,
            email,
            password: hashedPassword,
            phone,
            role: 'USER',
        });
        await user.save();


        const token = jwt.sign(user.id, process.env.JWT_SECRET);

        const userResponse = user.toObject();

        res.status(201).json({
            message: 'User registered successfully',
            user: userResponse,
            token,
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// ==================== LOGIN USER ====================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email, isActive: true });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ error: 'Your account has been blocked' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(user.id, process.env.JWT_SECRET);

        res.json({
            message: 'Login successful',
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// ==================== GET MY PROFILE ====================
router.get('/profile', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password')

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE MY PROFILE ====================
router.put('/updateProfile', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { Name, phone, dateOfBirth, gender } = req.body;

        const updateFields = {};
        if (Name) updateFields.Name = Name;
        if (phone) updateFields.phone = phone;
        if (dateOfBirth) updateFields.dateOfBirth = dateOfBirth;
        if (gender) updateFields.gender = gender;

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: updateFields },
            { new: true, runValidators: true }
        ).select('-password' );

        res.json({ message: 'Profile updated successfully', user });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE PROFILE IMAGE ====================
router.post('/uploadProfileImage', passport.authenticate('jwt', { session: false }), uploadUserProfile, handleMulterError, async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const user = await User.findById(userId);

        if (!user) {
            // Delete uploaded file if user not found
            if (req.file) {
                const filePath = path.join(__dirname, '../uploads/profiles/', req.file.filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No image file uploaded'
            });
        }

        // Check if user already has a profile image
        const existingImage = user.profileImage;

        // If existing image found, delete it from server and database
        if (existingImage) {
            // Delete image from server
            const imageDeleted = deleteImageFile(existingImage);

            if (imageDeleted) {
                console.log(`Old profile image deleted: ${existingImage}`);
            } else {
                console.warn(`Old profile image not found: ${existingImage}`);
            }
        }

        // Update user with new image
        const imageUrl = req.file.filename;
        user.profileImage = imageUrl;
        await user.save();

        res.status(200).json({
            success: true,
            message: existingImage ? 'Profile image updated successfully' : 'Profile image uploaded successfully',
            data: {
                profileImage: imageUrl,
                user: {
                    id: user._id,
                    name: user.Name,
                    email: user.email
                }
            }
        });

    } catch (error) {
        // Delete uploaded file if there's any error
        if (req.file) {
            const filePath = path.join(__dirname, '../uploads/profiles/', req.file.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Uploaded file deleted due to error: ${req.file.filename}`);
            }
        }

        console.error('Profile image upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while uploading profile image',
            error: error.message
        });
    }
}
);

// ==================== GET MY ADDRESS ====================
router.get('/address', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('address');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ address: user.address || {} });
    } catch (error) {
        console.error('Get address error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE MY ADDRESS ====================
router.put('/updateAddress', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { country, state, city, zipCode, addressLine } = req.body;

        const address = {
            country,
            state,
            city,
            zipCode,
            addressLine
        };

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { address },
            { new: true, runValidators: true }
        ).select('address');

        res.json({ message: 'Address updated successfully', address: user.address });
    } catch (error) {
        console.error('Update address error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE MY ACCOUNT ====================
router.delete('/deleteAccount', passport.authenticate('jwt', { session: false }), async (req, res) => {
        try {
            const { password } = req.body;

            // Check if password is provided
            if (!password) {
                return res.status(400).json({
                    success: false,
                    message: 'Password is required to delete account'
                });
            }

            // Find user
            const user = await User.findById(req.user._id);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            // Verify password
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Password is incorrect'
                });
            }

            // Start deleting all associated data

            // 1. Delete user's profile image
            if (user.profileImage) {
                deleteImageFile(user.profileImage);
                console.log(`Deleted profile image for user: ${user._id}`);
            }

            // 2. Find all hotels owned by user
            const hotels = await Hotel.find({ owner: user._id });

            if (hotels) {
                for (const hotel of hotels) {
                    // Delete hotel images
                    await deleteHotelImages(hotel._id);

                    // Find and delete all rooms in this hotel
                    const rooms = await Room.find({ hotel: hotel._id });
                    for (const room of rooms) {
                        // Delete room images
                        await deleteRoomImages(room._id);
                        // Delete room from database
                        await Room.findByIdAndDelete(room._id);
                        console.log(`Deleted room: ${room._id}`);
                    }

                    // Delete hotel from database
                    await Hotel.findByIdAndDelete(hotel._id);
                    console.log(`Deleted hotel: ${hotel._id}`);
                }
            }

            // 4. Delete user from database
            await User.findByIdAndDelete(user._id);
            console.log(`Deleted user account: ${user._id}`);

            res.status(200).json({
                success: true,
                message: 'Account deleted successfully',
                data: {
                    deletedUser: {
                        id: user._id,
                        name: user.Name,
                        email: user.email
                    }
                }
            });

        } catch (error) {
            console.error('Delete account error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error while deleting account',
                error: error.message
            });
        }
    }
);











////////////////////////////// Admin //////////////////////////////
////////////////////////////// Admin //////////////////////////////



// ==================== GET ALL USERS ====================
router.get('/getAllUsers', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            search,
            role,
            isActive,
            isBlocked,
            isVerified,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        // Search by name or email
        if (search) {
            query.$or = [
                { Name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        // Filter by role
        if (role && role !== 'all') {
            query.role = role;
        }

        // Filter by status
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        if (isBlocked !== undefined) {
            query.isBlocked = isBlocked === 'true';
        }

        if (isVerified !== undefined) {
            query.isVerified = isVerified === 'true';
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [users, totalCount] = await Promise.all([
            User.find(query)
                .select('-password')
                .populate('hotels', 'name location')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            User.countDocuments(query)
        ]);

        res.json({
            users,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalUsers: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE USER ====================
router.get('/getUser/:userId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }
       
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await User.findById(userId)
            .select('-password')
            .populate('hotels', 'name location description rating');

            if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Get single user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE USER ====================
router.put('/updateUser/:userId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const {
            Name,
            phone,
            dateOfBirth,
            gender,
            profileImage,
            address,
            businessInfo,
            hotels
        } = req.body;

        const updateFields = {};
        if (Name) updateFields.Name = Name;
        if (phone) updateFields.phone = phone;
        if (dateOfBirth) updateFields.dateOfBirth = dateOfBirth;
        if (gender) updateFields.gender = gender;
        if (profileImage !== undefined) updateFields.profileImage = profileImage;
        if (address) updateFields.address = address;
        if (businessInfo) updateFields.businessInfo = businessInfo;
        if (hotels) updateFields.hotels = hotels;

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updateFields },
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'User updated successfully',
            user
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});



// ==================== DELETE USER (Permanent) ====================
router.delete('/users/:userId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can permanently delete users
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Prevent deleting yourself
        if (userId === req.user._id.toString()) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        const user = await User.findByIdAndDelete(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User permanently deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BLOCK USER ====================
router.patch('/users/:userId/block', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Prevent blocking yourself
        if (userId === req.user._id.toString()) {
            return res.status(400).json({ error: 'You cannot block your own account' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    isBlocked: true,
                    isActive: false
                }
            },
            { new: true }
        ).select('-password' );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Clear refresh token when blocking
        await user.save();

        res.json({
            message: 'User blocked successfully',
            user
        });
    } catch (error) {
        console.error('Block user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UNBLOCK USER ====================
router.patch('/users/:userId/unblock', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    isBlocked: false,
                    isActive: true
                }
            },
            { new: true }
        ).select('-password' );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'User unblocked successfully',
            user
        });
    } catch (error) {
        console.error('Unblock user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ACTIVATE USER ====================
router.patch('/users/:userId/activate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { isActive: true },
            { new: true }
        ).select('-password' );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'User activated successfully',
            user
        });
    } catch (error) {
        console.error('Activate user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DEACTIVATE USER ====================
router.patch('/users/:userId/deactivate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Prevent deactivating yourself
        if (userId === req.user._id.toString()) {
            return res.status(400).json({ error: 'You cannot deactivate your own account' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { isActive: false },
            { new: true }
        ).select('-password' );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Clear refresh token when deactivating
        await user.save();

        res.json({
            message: 'User deactivated successfully',
            user
        });
    } catch (error) {
        console.error('Deactivate user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== VERIFY USER ====================
router.patch('/users/:userId/verify', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can verify users
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { isVerified: true },
            { new: true }
        ).select('-password' );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: 'User verified successfully',
            user
        });
    } catch (error) {
        console.error('Verify user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});













////////////////////////////// Super Admin //////////////////////////////
////////////////////////////// Super Admin //////////////////////////////



// ==================== CHANGE USER ROLE ====================
router.patch('/users/:userId/role', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can change roles
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { userId } = req.params;
        const { role } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (!role || !['SUPER_ADMIN', 'ADMIN', 'USER'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be SUPER_ADMIN, ADMIN, or USER' });
        }

        // Prevent changing your own role
        if (userId === req.user._id.toString()) {
            return res.status(400).json({ error: 'You cannot change your own role' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { role },
            { new: true }
        ).select('-password' );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            message: `User role changed to ${role} successfully`,
            user
        });
    } catch (error) {
        console.error('Change user role error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET USER HOTELS ====================
router.get('/users/:userId/hotels', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN, ADMIN, or the user themselves
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN' && req.user._id.toString() !== req.params.userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { userId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await User.findById(userId)
            .select('Name email hotels businessInfo')
            .populate('hotels', 'name location description rating images amenities');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            user: {
                id: user._id,
                Name: user.Name,
                email: user.email
            },
            businessInfo: user.businessInfo,
            hotels: user.hotels,
            totalHotels: user.hotels.length
        });
    } catch (error) {
        console.error('Get user hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL ADMINS ====================
router.get('/admins', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view all admins
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const {
            page = 1,
            limit = 10,
            search,
            role,
            isActive,
            isVerified,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {
            role: { $in: ['SUPER_ADMIN', 'ADMIN'] }
        };

        // Search by name or email
        if (search) {
            query.$or = [
                { Name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        // Filter by specific role
        if (role && role !== 'all') {
            query.role = role;
        }

        // Filter by status
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        if (isVerified !== undefined) {
            query.isVerified = isVerified === 'true';
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [admins, totalCount] = await Promise.all([
            User.find(query)
                .select('-password')
                .populate('hotels', 'name location')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            User.countDocuments(query)
        ]);

        // Separate SUPER_ADMIN and ADMIN
        const superAdmins = admins.filter(admin => admin.role === 'SUPER_ADMIN');
        const regularAdmins = admins.filter(admin => admin.role === 'ADMIN');

        res.json({
            admins: {
                superAdmins,
                regularAdmins,
                all: admins
            },
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalAdmins: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get all admins error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL USERS AND ADMINS ====================
router.get('/all-users-admins', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view all users and admins
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const {
            page = 1,
            limit = 20,
            search,
            role,
            isActive,
            isBlocked,
            isVerified,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        // Search by name or email
        if (search) {
            query.$or = [
                { Name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        // Filter by role
        if (role && role !== 'all') {
            if (role === 'ADMIN_ONLY') {
                query.role = { $in: ['SUPER_ADMIN', 'ADMIN'] };
            } else if (role === 'USER_ONLY') {
                query.role = 'USER';
            } else {
                query.role = role;
            }
        }

        // Filter by status
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        if (isBlocked !== undefined) {
            query.isBlocked = isBlocked === 'true';
        }

        if (isVerified !== undefined) {
            query.isVerified = isVerified === 'true';
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [users, totalCount] = await Promise.all([
            User.find(query)
                .select('-password')
                .populate('hotels', 'name')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            User.countDocuments(query)
        ]);

        // Separate users by role
        const adminsList = users.filter(u => u.role === 'SUPER_ADMIN' || u.role === 'ADMIN');
        const usersList = users.filter(u => u.role === 'USER');

        res.json({
            summary: {
                totalInPage: users.length,
                totalInSystem: totalCount,
                adminsInPage: adminsList.length,
                usersInPage: usersList.length
            },
            users: {
                admins: adminsList,
                regularUsers: usersList,
                all: users
            },
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalRecords: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get all users and admins error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;