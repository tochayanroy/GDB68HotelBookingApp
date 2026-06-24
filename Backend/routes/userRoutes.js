const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
// const { uploadProfile } = require('../middleware/multer.js');
const User = require('../models/UserSchema.js');
const checkAdmin = require('../middleware/checkAdmin.js');
const checkSuperAdmin = require('../middleware/checkSuperAdmin.js');




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
    
        res.json({
            message: 'Login successful',
            user: userResponse,
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});


// ==================== GET MY PROFILE ====================
router.get('/profile', passport.authenticate('jwt', { session: false }), checkSuperAdmin, async (req, res) => {
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
router.put('/profile', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
        ).select('-password -refreshToken');

        res.json({ message: 'Profile updated successfully', user });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE PROFILE IMAGE ====================
// router.put('/profile-image', passport.authenticate('jwt', { session: false }), uploadProfile.single('profileImage'), async (req, res) => {
//     try {
//         if (!req.file) {
//             return res.status(400).json({ error: 'No image file provided' });
//         }

//         const profileImageUrl = `/uploads/profiles/${req.file.filename}`;
        
//         const user = await User.findByIdAndUpdate(
//             req.user._id,
//             { profileImage: profileImageUrl },
//             { new: true }
//         ).select('-password -refreshToken');

//         res.json({ message: 'Profile image updated successfully', user });
//     } catch (error) {
//         console.error('Update profile image error:', error);
//         res.status(500).json({ error: 'Server error' });
//     }
// });

// ==================== CHANGE PASSWORD ====================
router.post('/change-password', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        const user = await User.findById(req.user._id);
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        
        user.password = hashedPassword;
        await user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== FORGOT PASSWORD ====================
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found with this email' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000; // 1 hour

        user.resetPasswordToken = resetToken;
        user.resetPasswordExpiry = resetTokenExpiry;
        await user.save();

        // In production, send email here
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        
        res.json({ 
            message: 'Password reset link sent to your email',
            resetUrl // Only for development, remove in production
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== RESET PASSWORD ====================
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        
        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpiry: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        
        user.password = hashedPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpiry = undefined;
        await user.save();

        res.json({ message: 'Password reset successfully' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== VERIFY EMAIL ====================
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;
        
        const user = await User.findOne({
            emailVerificationToken: token,
            emailVerificationExpiry: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired verification token' });
        }

        user.isVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpiry = undefined;
        await user.save();

        res.json({ message: 'Email verified successfully' });
    } catch (error) {
        console.error('Verify email error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== RESEND VERIFICATION EMAIL ====================
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.isVerified) {
            return res.status(400).json({ error: 'Email already verified' });
        }

        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationExpiry = Date.now() + 86400000; // 24 hours

        user.emailVerificationToken = verificationToken;
        user.emailVerificationExpiry = verificationExpiry;
        await user.save();

        // In production, send email here
        const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
        
        res.json({ 
            message: 'Verification email sent',
            verifyUrl // Only for development, remove in production
        });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

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
router.put('/address', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
router.delete('/account', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { password } = req.body;
        
        const user = await User.findById(req.user._id);
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Password is incorrect' });
        }

        // Soft delete - mark as inactive
        user.isActive = false;
        user.isBlocked = true;
        user.refreshToken = undefined;
        await user.save();

        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL USERS ====================
router.get('/users', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
                .select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry')
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
router.get('/users/:userId', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
            .select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry')
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

// ==================== CREATE USER (Admin only) ====================
router.post('/users', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            Name,
            email,
            phone,
            password,
            dateOfBirth,
            gender,
            role,
            profileImage,
            address,
            businessInfo,
            hotels
        } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists with this email or phone' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const user = new User({
            Name,
            email,
            phone,
            password: hashedPassword,
            dateOfBirth,
            gender,
            role: role || 'USER',
            profileImage,
            address,
            businessInfo,
            hotels: hotels || [],
            isVerified: req.user.role === 'SUPER_ADMIN' ? true : false // SUPER_ADMIN can create verified users
        });

        await user.save();

        const userResponse = user.toObject();
        delete userResponse.password;
        delete userResponse.refreshToken;
        delete userResponse.resetPasswordToken;
        delete userResponse.resetPasswordExpiry;
        delete userResponse.emailVerificationToken;
        delete userResponse.emailVerificationExpiry;

        res.status(201).json({
            message: 'User created successfully',
            user: userResponse
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE USER ====================
router.put('/users/:userId', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
        ).select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry');

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
        ).select('-password -refreshToken');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Clear refresh token when blocking
        user.refreshToken = undefined;
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
        ).select('-password -refreshToken');

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
        ).select('-password -refreshToken');

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
        ).select('-password -refreshToken');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Clear refresh token when deactivating
        user.refreshToken = undefined;
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
        ).select('-password -refreshToken');

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
        ).select('-password -refreshToken');

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

// ==================== GET DASHBOARD USERS STATISTICS ====================
router.get('/dashboard/stats', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        const [
            totalUsers,
            activeUsers,
            blockedUsers,
            verifiedUsers,
            unverifiedUsers,
            superAdmins,
            admins,
            regularUsers,
            newUsersToday,
            newUsersThisWeek,
            newUsersThisMonth,
            newUsersThisYear,
            usersByGender,
            usersWithHotels,
            usersWithoutHotels
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ isActive: true }),
            User.countDocuments({ isBlocked: true }),
            User.countDocuments({ isVerified: true }),
            User.countDocuments({ isVerified: false }),
            User.countDocuments({ role: 'SUPER_ADMIN' }),
            User.countDocuments({ role: 'ADMIN' }),
            User.countDocuments({ role: 'USER' }),
            User.countDocuments({ createdAt: { $gte: startOfToday } }),
            User.countDocuments({ createdAt: { $gte: startOfWeek } }),
            User.countDocuments({ createdAt: { $gte: startOfMonth } }),
            User.countDocuments({ createdAt: { $gte: startOfYear } }),
            User.aggregate([
                { $group: { _id: '$gender', count: { $sum: 1 } } }
            ]),
            User.countDocuments({ hotels: { $exists: true, $ne: [] } }),
            User.countDocuments({ $or: [{ hotels: { $exists: false } }, { hotels: [] }] })
        ]);

        // Get recent users
        const recentUsers = await User.find()
            .select('Name email role isVerified isActive createdAt profileImage')
            .sort('-createdAt')
            .limit(10);

        // Get users by role distribution
        const roleDistribution = {
            SUPER_ADMIN: superAdmins,
            ADMIN: admins,
            USER: regularUsers
        };

        // Format gender data
        const genderData = {
            MALE: 0,
            FEMALE: 0,
            OTHER: 0
        };
        usersByGender.forEach(item => {
            if (item._id === 'MALE') genderData.MALE = item.count;
            else if (item._id === 'FEMALE') genderData.FEMALE = item.count;
            else if (item._id === 'OTHER') genderData.OTHER = item.count;
        });

        // Calculate percentages
        const activePercentage = totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : 0;
        const verifiedPercentage = totalUsers > 0 ? ((verifiedUsers / totalUsers) * 100).toFixed(1) : 0;

        res.json({
            overview: {
                totalUsers,
                activeUsers,
                blockedUsers,
                verifiedUsers,
                unverifiedUsers,
                activePercentage: parseFloat(activePercentage),
                verifiedPercentage: parseFloat(verifiedPercentage)
            },
            roleDistribution,
            genderDistribution: genderData,
            hotelOwners: {
                withHotels: usersWithHotels,
                withoutHotels: usersWithoutHotels,
                percentage: totalUsers > 0 ? ((usersWithHotels / totalUsers) * 100).toFixed(1) : 0
            },
            userGrowth: {
                today: newUsersToday,
                thisWeek: newUsersThisWeek,
                thisMonth: newUsersThisMonth,
                thisYear: newUsersThisYear
            },
            recentUsers,
            timestamp: now
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
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
                .select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry')
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

// ==================== CREATE ADMIN ====================
router.post('/admins', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can create admins
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const {
            Name,
            email,
            phone,
            password,
            dateOfBirth,
            gender,
            role,
            profileImage,
            address,
            businessInfo
        } = req.body;

        // Validate role
        const adminRole = role || 'ADMIN';
        if (!['SUPER_ADMIN', 'ADMIN'].includes(adminRole)) {
            return res.status(400).json({ error: 'Role must be SUPER_ADMIN or ADMIN' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists with this email or phone' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new admin
        const admin = new User({
            Name,
            email,
            phone,
            password: hashedPassword,
            dateOfBirth,
            gender,
            role: adminRole,
            profileImage,
            address,
            businessInfo,
            isVerified: true, // Admins are auto-verified
            isActive: true
        });

        await admin.save();

        const adminResponse = admin.toObject();
        delete adminResponse.password;
        delete adminResponse.refreshToken;
        delete adminResponse.resetPasswordToken;
        delete adminResponse.resetPasswordExpiry;
        delete adminResponse.emailVerificationToken;
        delete adminResponse.emailVerificationExpiry;

        res.status(201).json({
            message: `${adminRole} created successfully`,
            admin: adminResponse
        });
    } catch (error) {
        console.error('Create admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE ADMIN ====================
router.put('/admins/:adminId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can update admins
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { adminId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(adminId)) {
            return res.status(400).json({ error: 'Invalid admin ID' });
        }

        const {
            Name,
            phone,
            dateOfBirth,
            gender,
            profileImage,
            address,
            businessInfo,
            isActive,
            isVerified
        } = req.body;

        // Check if user exists and is an admin
        const existingAdmin = await User.findOne({ _id: adminId, role: { $in: ['SUPER_ADMIN', 'ADMIN'] } });
        if (!existingAdmin) {
            return res.status(404).json({ error: 'Admin not found' });
        }

        // Prevent updating the last SUPER_ADMIN
        if (existingAdmin.role === 'SUPER_ADMIN' && isActive === false) {
            const superAdminCount = await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true });
            if (superAdminCount === 1) {
                return res.status(400).json({ error: 'Cannot deactivate the last SUPER_ADMIN' });
            }
        }

        const updateFields = {};
        if (Name) updateFields.Name = Name;
        if (phone) updateFields.phone = phone;
        if (dateOfBirth) updateFields.dateOfBirth = dateOfBirth;
        if (gender) updateFields.gender = gender;
        if (profileImage !== undefined) updateFields.profileImage = profileImage;
        if (address) updateFields.address = address;
        if (businessInfo) updateFields.businessInfo = businessInfo;
        if (isActive !== undefined) updateFields.isActive = isActive;
        if (isVerified !== undefined) updateFields.isVerified = isVerified;

        const admin = await User.findByIdAndUpdate(
            adminId,
            { $set: updateFields },
            { new: true, runValidators: true }
        ).select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry');

        res.json({
            message: 'Admin updated successfully',
            admin
        });
    } catch (error) {
        console.error('Update admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE ADMIN ====================
router.delete('/admins/:adminId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can delete admins
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { adminId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(adminId)) {
            return res.status(400).json({ error: 'Invalid admin ID' });
        }

        // Prevent deleting yourself
        if (adminId === req.user._id.toString()) {
            return res.status(400).json({ error: 'You cannot delete your own admin account' });
        }

        const admin = await User.findOne({ _id: adminId, role: { $in: ['SUPER_ADMIN', 'ADMIN'] } });
        
        if (!admin) {
            return res.status(404).json({ error: 'Admin not found' });
        }

        // Prevent deleting the last SUPER_ADMIN
        if (admin.role === 'SUPER_ADMIN') {
            const superAdminCount = await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true });
            if (superAdminCount === 1) {
                return res.status(400).json({ error: 'Cannot delete the last SUPER_ADMIN' });
            }
        }

        // Soft delete - mark as inactive
        admin.isActive = false;
        admin.isBlocked = true;
        admin.role = 'USER'; // Demote to user
        admin.refreshToken = undefined;
        await admin.save();

        res.json({ message: 'Admin deleted and demoted to user successfully' });
    } catch (error) {
        console.error('Delete admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== PROMOTE USER TO ADMIN ====================
router.patch('/promote/:userId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can promote users
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { userId } = req.params;
        const { adminRole = 'ADMIN' } = req.body; // ADMIN or SUPER_ADMIN

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (!['ADMIN', 'SUPER_ADMIN'].includes(adminRole)) {
            return res.status(400).json({ error: 'Admin role must be ADMIN or SUPER_ADMIN' });
        }

        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
            return res.status(400).json({ error: 'User is already an admin' });
        }

        // Promote user
        user.role = adminRole;
        user.isVerified = true;
        user.isActive = true;
        user.isBlocked = false;
        await user.save();

        const userResponse = user.toObject();
        delete userResponse.password;
        delete userResponse.refreshToken;

        res.json({
            message: `User promoted to ${adminRole} successfully`,
            user: userResponse
        });
    } catch (error) {
        console.error('Promote user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DEMOTE ADMIN TO USER ====================
router.patch('/demote/:adminId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can demote admins
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { adminId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(adminId)) {
            return res.status(400).json({ error: 'Invalid admin ID' });
        }

        // Prevent demoting yourself
        if (adminId === req.user._id.toString()) {
            return res.status(400).json({ error: 'You cannot demote your own account' });
        }

        const admin = await User.findOne({ _id: adminId, role: { $in: ['SUPER_ADMIN', 'ADMIN'] } });
        
        if (!admin) {
            return res.status(404).json({ error: 'Admin not found' });
        }

        // Prevent demoting the last SUPER_ADMIN
        if (admin.role === 'SUPER_ADMIN') {
            const superAdminCount = await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true });
            if (superAdminCount === 1) {
                return res.status(400).json({ error: 'Cannot demote the last SUPER_ADMIN' });
            }
        }

        // Demote to user
        admin.role = 'USER';
        await admin.save();

        const adminResponse = admin.toObject();
        delete adminResponse.password;
        delete adminResponse.refreshToken;

        res.json({
            message: 'Admin demoted to user successfully',
            user: adminResponse
        });
    } catch (error) {
        console.error('Demote admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SYSTEM USER STATISTICS ====================
router.get('/system-stats', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view system stats
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const [
            totalUsers,
            totalAdmins,
            totalSuperAdmins,
            totalActiveAdmins,
            totalInactiveAdmins,
            totalVerifiedAdmins,
            totalUsersOnly,
            activeUsersOnly,
            blockedUsersOnly,
            verifiedUsersOnly,
            adminByRole,
            recentlyPromotedAdmins,
            recentlyDemotedUsers
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ role: { $in: ['SUPER_ADMIN', 'ADMIN'] } }),
            User.countDocuments({ role: 'SUPER_ADMIN' }),
            User.countDocuments({ role: { $in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: true }),
            User.countDocuments({ role: { $in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: false }),
            User.countDocuments({ role: { $in: ['SUPER_ADMIN', 'ADMIN'] }, isVerified: true }),
            User.countDocuments({ role: 'USER' }),
            User.countDocuments({ role: 'USER', isActive: true }),
            User.countDocuments({ role: 'USER', isBlocked: true }),
            User.countDocuments({ role: 'USER', isVerified: true }),
            User.aggregate([
                { $match: { role: { $in: ['SUPER_ADMIN', 'ADMIN'] } } },
                { $group: { _id: '$role', count: { $sum: 1 } } }
            ]),
            User.find({ role: { $in: ['SUPER_ADMIN', 'ADMIN'] } })
                .sort('-updatedAt')
                .limit(5)
                .select('Name email role createdAt updatedAt'),
            User.find({ 
                $and: [
                    { role: 'USER' },
                    { 'timestamps.updatedAt': { $exists: true } }
                ]
            })
                .sort('-updatedAt')
                .limit(5)
                .select('Name email role createdAt updatedAt')
        ]);

        // Format admin role distribution
        const adminRoleDistribution = {
            SUPER_ADMIN: 0,
            ADMIN: 0
        };
        adminByRole.forEach(item => {
            if (item._id === 'SUPER_ADMIN') adminRoleDistribution.SUPER_ADMIN = item.count;
            if (item._id === 'ADMIN') adminRoleDistribution.ADMIN = item.count;
        });

        // Calculate ratios
        const adminToUserRatio = totalUsersOnly > 0 ? (totalAdmins / totalUsersOnly).toFixed(2) : 0;
        const activeAdminPercentage = totalAdmins > 0 ? ((totalActiveAdmins / totalAdmins) * 100).toFixed(1) : 0;

        res.json({
            summary: {
                totalUsersInSystem: totalUsers,
                totalAdmins: totalAdmins,
                totalSuperAdmins: totalSuperAdmins,
                totalRegularUsers: totalUsersOnly,
                adminToUserRatio: parseFloat(adminToUserRatio)
            },
            adminStats: {
                total: totalAdmins,
                active: totalActiveAdmins,
                inactive: totalInactiveAdmins,
                verified: totalVerifiedAdmins,
                activePercentage: parseFloat(activeAdminPercentage),
                roleDistribution: adminRoleDistribution
            },
            userStats: {
                total: totalUsersOnly,
                active: activeUsersOnly,
                blocked: blockedUsersOnly,
                verified: verifiedUsersOnly,
                activePercentage: totalUsersOnly > 0 ? ((activeUsersOnly / totalUsersOnly) * 100).toFixed(1) : 0,
                verifiedPercentage: totalUsersOnly > 0 ? ((verifiedUsersOnly / totalUsersOnly) * 100).toFixed(1) : 0
            },
            recentChanges: {
                recentlyPromotedAdmins,
                recentlyDemotedUsers
            },
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Get system stats error:', error);
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
                .select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry')
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

// ==================== MANAGE ROLES AND PERMISSIONS ====================
router.put('/manage-roles/:userId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can manage roles
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { userId } = req.params;
        const { role, isVerified, isActive, isBlocked } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Prevent changing your own role/status
        if (userId === req.user._id.toString()) {
            return res.status(400).json({ error: 'You cannot modify your own role or status' });
        }

        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updates = {};
        const warnings = [];

        // Update role if provided
        if (role && role !== user.role) {
            if (!['SUPER_ADMIN', 'ADMIN', 'USER'].includes(role)) {
                return res.status(400).json({ error: 'Invalid role. Must be SUPER_ADMIN, ADMIN, or USER' });
            }

            // Check if trying to demote the last SUPER_ADMIN
            if (user.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
                const superAdminCount = await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true });
                if (superAdminCount === 1) {
                    warnings.push('Cannot demote the last SUPER_ADMIN. Role change skipped.');
                } else {
                    updates.role = role;
                }
            } else {
                updates.role = role;
            }
        }

        // Update verification status
        if (isVerified !== undefined && isVerified !== user.isVerified) {
            updates.isVerified = isVerified;
        }

        // Update active status
        if (isActive !== undefined && isActive !== user.isActive) {
            // Check if trying to deactivate the last SUPER_ADMIN
            if (user.role === 'SUPER_ADMIN' && isActive === false) {
                const superAdminCount = await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true });
                if (superAdminCount === 1) {
                    warnings.push('Cannot deactivate the last SUPER_ADMIN. Status change skipped.');
                } else {
                    updates.isActive = isActive;
                    if (isActive === false) {
                        updates.refreshToken = undefined;
                    }
                }
            } else {
                updates.isActive = isActive;
                if (isActive === false) {
                    updates.refreshToken = undefined;
                }
            }
        }

        // Update blocked status
        if (isBlocked !== undefined && isBlocked !== user.isBlocked) {
            // Check if trying to block the last SUPER_ADMIN
            if (user.role === 'SUPER_ADMIN' && isBlocked === true) {
                const superAdminCount = await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true });
                if (superAdminCount === 1) {
                    warnings.push('Cannot block the last SUPER_ADMIN. Status change skipped.');
                } else {
                    updates.isBlocked = isBlocked;
                    if (isBlocked === true) {
                        updates.isActive = false;
                        updates.refreshToken = undefined;
                    }
                }
            } else {
                updates.isBlocked = isBlocked;
                if (isBlocked === true) {
                    updates.isActive = false;
                    updates.refreshToken = undefined;
                } else {
                    updates.isActive = true;
                }
            }
        }

        if (Object.keys(updates).length === 0 && warnings.length === 0) {
            return res.status(400).json({ error: 'No changes to apply' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry');

        const response = {
            message: 'User role and permissions updated successfully',
            user: updatedUser
        };

        if (warnings.length > 0) {
            response.warnings = warnings;
        }

        res.json(response);
    } catch (error) {
        console.error('Manage roles error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROLE PERMISSIONS MATRIX ====================
router.get('/permissions-matrix', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view permissions matrix
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        // Define permission matrix based on roles
        const permissionsMatrix = {
            SUPER_ADMIN: {
                manageAdmins: true,
                manageUsers: true,
                manageHotels: true,
                manageBookings: true,
                viewReports: true,
                manageSystem: true,
                manageRoles: true,
                deleteAnyUser: true,
                blockAnyUser: true,
                verifyAnyUser: true,
                viewAllData: true,
                modifySettings: true
            },
            ADMIN: {
                manageAdmins: false,
                manageUsers: true,
                manageHotels: true,
                manageBookings: true,
                viewReports: true,
                manageSystem: false,
                manageRoles: false,
                deleteAnyUser: false,
                blockAnyUser: true,
                verifyAnyUser: false,
                viewAllData: true,
                modifySettings: false
            },
            USER: {
                manageAdmins: false,
                manageUsers: false,
                manageHotels: false,
                manageBookings: false,
                viewReports: false,
                manageSystem: false,
                manageRoles: false,
                deleteAnyUser: false,
                blockAnyUser: false,
                verifyAnyUser: false,
                viewAllData: false,
                modifySettings: false
            }
        };

        // Get counts for each role
        const roleCounts = {
            SUPER_ADMIN: await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true }),
            ADMIN: await User.countDocuments({ role: 'ADMIN', isActive: true }),
            USER: await User.countDocuments({ role: 'USER', isActive: true })
        };

        res.json({
            permissionsMatrix,
            roleCounts,
            totalActiveUsers: roleCounts.SUPER_ADMIN + roleCounts.ADMIN + roleCounts.USER,
            lastUpdated: new Date()
        });
    } catch (error) {
        console.error('Get permissions matrix error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;