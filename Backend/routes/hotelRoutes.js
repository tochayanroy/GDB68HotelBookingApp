const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');
const slugify = require('slugify');

const Hotel = require('../models/HotelSchema.js');
const Room = require('../models/RoomSchema.js');
const Review = require('../models/ReviewSchema.js');

// ==================== GET ALL HOTELS ====================
router.get('/hotels', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc',
            status = 'APPROVED',
            isActive = true
        } = req.query;

        const query = {
            status: status,
            isActive: isActive === 'true'
        };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [hotels, totalCount] = await Promise.all([
            Hotel.find(query)
                .populate('owner', 'Name email phone profileImage')
                .populate('rooms', 'roomType pricePerNight capacity')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Hotel.countDocuments(query)
        ]);

        res.json({
            hotels,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalHotels: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get all hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE HOTEL ====================
router.get('/hotels/:hotelId', async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId)
            .populate('owner', 'Name email phone profileImage businessInfo')
            .populate('rooms', 'roomType pricePerNight capacity bedTypes amenities images')
            .populate('reviews', 'rating comment createdAt user');

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        // Check if hotel is accessible
        if (hotel.status !== 'APPROVED' || !hotel.isActive) {
            return res.status(403).json({ error: 'Hotel is not available' });
        }

        res.json(hotel);
    } catch (error) {
        console.error('Get single hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET HOTEL BY SLUG ====================
router.get('/hotels/slug/:slug', async (req, res) => {
    try {
        const { slug } = req.params;

        const hotel = await Hotel.findOne({ slug, status: 'APPROVED', isActive: true })
            .populate('owner', 'Name email phone profileImage')
            .populate('rooms', 'roomType pricePerNight capacity bedTypes amenities images')
            .populate({
                path: 'reviews',
                populate: {
                    path: 'user',
                    select: 'Name profileImage'
                }
            });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        res.json(hotel);
    } catch (error) {
        console.error('Get hotel by slug error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SEARCH HOTELS ====================
router.get('/hotels/search', async (req, res) => {
    try {
        const {
            q,
            city,
            state,
            country,
            page = 1,
            limit = 10,
            sortBy = 'averageRating',
            sortOrder = 'desc'
        } = req.query;

        const query = {
            status: 'APPROVED',
            isActive: true
        };

        // Text search
        if (q) {
            query.$or = [
                { name: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } },
                { 'address.city': { $regex: q, $options: 'i' } },
                { 'address.state': { $regex: q, $options: 'i' } }
            ];
        }

        // Filter by city
        if (city) {
            query['address.city'] = { $regex: city, $options: 'i' };
        }

        // Filter by state
        if (state) {
            query['address.state'] = { $regex: state, $options: 'i' };
        }

        // Filter by country
        if (country) {
            query['address.country'] = { $regex: country, $options: 'i' };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [hotels, totalCount] = await Promise.all([
            Hotel.find(query)
                .populate('owner', 'Name email')
                .populate('rooms', 'roomType pricePerNight')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Hotel.countDocuments(query)
        ]);

        res.json({
            searchQuery: q || '',
            filters: { city, state, country },
            results: hotels,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalResults: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Search hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== FILTER HOTELS ====================

router.get('/hotels/filter', async (req, res) => {
    try {
        const {
            minStarRating,
            maxStarRating,
            minPrice,
            maxPrice,
            amenities,
            city,
            state,
            country,
            page = 1,
            limit = 10,
            sortBy = 'averageRating',
            sortOrder = 'desc'
        } = req.query;

        const query = {
            status: 'APPROVED',
            isActive: true
        };

        // Filter by star rating
        if (minStarRating || maxStarRating) {
            query.starRating = {};
            if (minStarRating) query.starRating.$gte = parseInt(minStarRating);
            if (maxStarRating) query.starRating.$lte = parseInt(maxStarRating);
        }

        // Filter by address
        if (city) query['address.city'] = { $regex: city, $options: 'i' };
        if (state) query['address.state'] = { $regex: state, $options: 'i' };
        if (country) query['address.country'] = { $regex: country, $options: 'i' };

        // Filter by amenities
        if (amenities) {
            const amenitiesArray = amenities.split(',');
            query.amenities = { $all: amenitiesArray };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        let hotels = await Hotel.find(query)
            .populate('owner', 'Name email')
            .populate('rooms', 'roomType pricePerNight capacity')
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit));

        // Filter by price range (needs room data)
        if (minPrice || maxPrice) {
            hotels = hotels.filter(hotel => {
                const minRoomPrice = Math.min(...hotel.rooms.map(room => room.pricePerNight));
                const maxRoomPrice = Math.max(...hotel.rooms.map(room => room.pricePerNight));

                let matches = true;
                if (minPrice && minRoomPrice < parseInt(minPrice)) matches = false;
                if (maxPrice && maxRoomPrice > parseInt(maxPrice)) matches = false;
                return matches;
            });
        }

        const totalCount = await Hotel.countDocuments(query);

        res.json({
            filters: {
                starRating: { min: minStarRating, max: maxStarRating },
                price: { min: minPrice, max: maxPrice },
                amenities: amenities ? amenities.split(',') : [],
                location: { city, state, country }
            },
            hotels,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalResults: hotels.length,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Filter hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET FEATURED HOTELS ====================
router.get('/hotels/featured', async (req, res) => {
    try {
        const {
            limit = 10,
            minStarRating = 3
        } = req.query;

        const hotels = await Hotel.find({
            isFeatured: true,
            status: 'APPROVED',
            isActive: true,
            starRating: { $gte: parseInt(minStarRating) }
        })
            .populate('owner', 'Name email')
            .populate('rooms', 'roomType pricePerNight')
            .sort({ averageRating: -1, starRating: -1 })
            .limit(parseInt(limit));

        res.json({
            featuredHotels: hotels,
            count: hotels.length
        });
    } catch (error) {
        console.error('Get featured hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET TOP RATED HOTELS ====================
router.get('/hotels/top-rated', async (req, res) => {
    try {
        const {
            limit = 10,
            minReviews = 5
        } = req.query;

        const hotels = await Hotel.find({
            status: 'APPROVED',
            isActive: true,
            averageRating: { $gte: 4 },
            totalReviews: { $gte: parseInt(minReviews) }
        })
            .populate('owner', 'Name email')
            .populate('rooms', 'roomType pricePerNight')
            .sort({ averageRating: -1, totalReviews: -1 })
            .limit(parseInt(limit));

        res.json({
            topRatedHotels: hotels,
            count: hotels.length
        });
    } catch (error) {
        console.error('Get top rated hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET HOTEL ROOMS ====================
router.get('/hotels/:hotelId/rooms', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const {
            checkIn,
            checkOut,
            adults = 1,
            children = 0,
            page = 1,
            limit = 10
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findOne({
            _id: hotelId,
            status: 'APPROVED',
            isActive: true
        }).populate({
            path: 'rooms',
            match: { isActive: true },
            populate: {
                path: 'bookings',
                match: checkIn && checkOut ? {
                    $or: [
                        { checkIn: { $lte: new Date(checkOut), $gte: new Date(checkIn) } },
                        { checkOut: { $lte: new Date(checkOut), $gte: new Date(checkIn) } }
                    ]
                } : null
            }
        });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        let rooms = hotel.rooms;

        // Filter by capacity
        rooms = rooms.filter(room =>
            room.capacity.adults >= parseInt(adults) &&
            room.capacity.children >= parseInt(children)
        );

        // Calculate availability if dates provided
        if (checkIn && checkOut) {
            rooms = rooms.map(room => {
                const roomObj = room.toObject();
                const isAvailable = !room.bookings || room.bookings.length === 0;
                roomObj.isAvailable = isAvailable;
                delete roomObj.bookings;
                return roomObj;
            });
        }

        // Pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const paginatedRooms = rooms.slice(skip, skip + parseInt(limit));

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name,
                starRating: hotel.starRating,
                address: hotel.address
            },
            rooms: paginatedRooms,
            totalRooms: rooms.length,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(rooms.length / parseInt(limit)),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get hotel rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET HOTEL REVIEWS ====================
router.get('/hotels/:hotelId/reviews', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const {
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc',
            minRating
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findOne({
            _id: hotelId,
            status: 'APPROVED',
            isActive: true
        }).select('name averageRating totalReviews');

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        const query = {
            hotel: hotelId,
            isVerified: true
        };

        if (minRating) {
            query.rating = { $gte: parseInt(minRating) };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [reviews, totalCount] = await Promise.all([
            Review.find(query)
                .populate('user', 'Name profileImage')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Review.countDocuments(query)
        ]);

        // Calculate rating distribution
        const ratingDistribution = await Review.aggregate([
            { $match: { hotel: new mongoose.Types.ObjectId(hotelId), isVerified: true } },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        const distribution = {
            1: 0, 2: 0, 3: 0, 4: 0, 5: 0
        };
        ratingDistribution.forEach(item => {
            distribution[item._id] = item.count;
        });

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name,
                averageRating: hotel.averageRating,
                totalReviews: hotel.totalReviews
            },
            ratingDistribution: distribution,
            reviews,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalReviews: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get hotel reviews error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// ==================== GET MY HOTELS ====================
router.get('/my-hotels', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            isActive,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {
            owner: req.user._id
        };

        if (status && status !== 'all') {
            query.status = status;
        }

        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [hotels, totalCount] = await Promise.all([
            Hotel.find(query)
                .populate('rooms', 'roomType pricePerNight capacity')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Hotel.countDocuments(query)
        ]);

        // Get statistics for each hotel
        const hotelsWithStats = await Promise.all(hotels.map(async (hotel) => {
            const totalRooms = hotel.rooms.length;
            const totalBookings = await Booking.countDocuments({ hotel: hotel._id });
            const totalReviews = await Review.countDocuments({ hotel: hotel._id, isVerified: true });

            return {
                ...hotel.toObject(),
                stats: {
                    totalRooms,
                    totalBookings,
                    totalReviews,
                    averageRating: hotel.averageRating
                }
            };
        }));

        res.json({
            hotels: hotelsWithStats,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalHotels: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get my hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CREATE HOTEL ====================
router.post('/hotels', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const {
            name,
            description,
            contact,
            address,
            location,
            starRating,
            amenities,
            policies
        } = req.body;

        // Check if hotel with same name already exists for this owner
        const existingHotel = await Hotel.findOne({
            name: { $regex: new RegExp(`^${name}$`, 'i') },
            owner: req.user._id
        });

        if (existingHotel) {
            return res.status(400).json({ error: 'You already have a hotel with this name' });
        }

        // Generate slug
        let slug = slugify(name, { lower: true, strict: true });
        let slugExists = await Hotel.findOne({ slug });
        if (slugExists) {
            slug = `${slug}-${Date.now()}`;
        }

        // Create hotel
        const hotel = new Hotel({
            name,
            slug,
            description,
            owner: req.user._id,
            thumbnail: req.body.thumbnail || null,
            contact: JSON.parse(contact),
            address: JSON.parse(address),
            location: location ? JSON.parse(location) : { type: 'Point', coordinates: [0, 0] },
            starRating: starRating || 3,
            amenities: amenities || [],
            policies: policies ? JSON.parse(policies) : {},
            status: 'PENDING',
            isActive: true
        });

        await hotel.save();

        // Add hotel to user's hotels array
        await User.findByIdAndUpdate(req.user._id, {
            $push: { hotels: hotel._id }
        });

        res.status(201).json({
            message: 'Hotel created successfully. Waiting for admin approval.',
            hotel
        });
    } catch (error) {
        console.error('Create hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE MY HOTEL ====================
router.put('/hotels/:hotelId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
        }

        // Don't allow editing if hotel is approved and pending changes
        if (hotel.status === 'APPROVED') {
            hotel.status = 'PENDING'; // Resubmit for approval
        }

        const {
            name,
            description,
            contact,
            address,
            location,
            starRating,
            amenities,
            policies,
            isActive
        } = req.body;

        // Update slug if name changed
        if (name && name !== hotel.name) {
            let slug = slugify(name, { lower: true, strict: true });
            let slugExists = await Hotel.findOne({ slug, _id: { $ne: hotelId } });
            if (slugExists) {
                slug = `${slug}-${Date.now()}`;
            }
            hotel.slug = slug;
            hotel.name = name;
        }

        if (description) hotel.description = description;
        if (contact) hotel.contact = JSON.parse(contact);
        if (address) hotel.address = JSON.parse(address);
        if (location) hotel.location = JSON.parse(location);
        if (starRating) hotel.starRating = starRating;
        if (amenities) hotel.amenities = amenities;
        if (policies) hotel.policies = JSON.parse(policies);
        if (isActive !== undefined) hotel.isActive = isActive;

        await hotel.save();

        res.json({
            message: 'Hotel updated successfully. Changes submitted for approval.',
            hotel
        });
    } catch (error) {
        console.error('Update hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE MY HOTEL ====================
router.delete('/hotels/:hotelId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
        }

        // Check if there are active bookings
        const activeBookings = await Booking.countDocuments({
            hotel: hotelId,
            status: { $in: ['CONFIRMED', 'PENDING', 'CHECKED_IN'] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({
                error: 'Cannot delete hotel with active bookings. Please cancel all bookings first.'
            });
        }

        // Soft delete - mark as inactive
        hotel.isActive = false;
        hotel.status = 'SUSPENDED';
        await hotel.save();

        // Remove hotel from user's hotels array
        await User.findByIdAndUpdate(req.user._id, {
            $pull: { hotels: hotelId }
        });

        res.json({ message: 'Hotel deactivated successfully' });
    } catch (error) {
        console.error('Delete hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPLOAD HOTEL THUMBNAIL ====================
router.post('/hotels/:hotelId/thumbnail',
    passport.authenticate('jwt', { session: false }),
    uploadHotelThumbnail.single('thumbnail'),
    async (req, res) => {
        try {
            const { hotelId } = req.params;

            if (!mongoose.Types.ObjectId.isValid(hotelId)) {
                return res.status(400).json({ error: 'Invalid hotel ID' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No thumbnail file provided' });
            }

            const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });

            if (!hotel) {
                return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
            }

            // Delete old thumbnail if exists
            if (hotel.thumbnail) {
                const oldThumbnailPath = path.join(__dirname, '..', hotel.thumbnail);
                if (fs.existsSync(oldThumbnailPath)) {
                    fs.unlinkSync(oldThumbnailPath);
                }
            }

            const thumbnailUrl = `/uploads/hotels/thumbnails/${req.file.filename}`;
            hotel.thumbnail = thumbnailUrl;
            await hotel.save();

            res.json({
                message: 'Hotel thumbnail uploaded successfully',
                thumbnail: thumbnailUrl
            });
        } catch (error) {
            console.error('Upload thumbnail error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ==================== UPLOAD HOTEL IMAGES ====================
router.post('/hotels/:hotelId/images',
    passport.authenticate('jwt', { session: false }),
    uploadHotelImages.array('images', 10),
    async (req, res) => {
        try {
            const { hotelId } = req.params;

            if (!mongoose.Types.ObjectId.isValid(hotelId)) {
                return res.status(400).json({ error: 'Invalid hotel ID' });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No image files provided' });
            }

            const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });

            if (!hotel) {
                return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
            }

            const imageUrls = req.files.map(file => `/uploads/hotels/images/${file.filename}`);
            hotel.images.push(...imageUrls);
            await hotel.save();

            res.json({
                message: `${imageUrls.length} images uploaded successfully`,
                images: hotel.images
            });
        } catch (error) {
            console.error('Upload images error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ==================== DELETE HOTEL IMAGE ====================
router.delete('/hotels/:hotelId/images',
    passport.authenticate('jwt', { session: false }),
    async (req, res) => {
        try {
            const { hotelId } = req.params;
            const { imageUrl } = req.body;

            if (!mongoose.Types.ObjectId.isValid(hotelId)) {
                return res.status(400).json({ error: 'Invalid hotel ID' });
            }

            if (!imageUrl) {
                return res.status(400).json({ error: 'Image URL is required' });
            }

            const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });

            if (!hotel) {
                return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
            }

            // Remove from images array
            const imageIndex = hotel.images.indexOf(imageUrl);
            if (imageIndex === -1) {
                return res.status(404).json({ error: 'Image not found in hotel gallery' });
            }

            hotel.images.splice(imageIndex, 1);
            await hotel.save();

            // Delete file from filesystem
            const imagePath = path.join(__dirname, '..', imageUrl);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }

            res.json({
                message: 'Image deleted successfully',
                images: hotel.images
            });
        } catch (error) {
            console.error('Delete image error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ==================== GET MY HOTEL STATISTICS ====================
router.get('/hotels/:hotelId/stats', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id })
            .populate('rooms');

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        const [
            totalBookings,
            confirmedBookings,
            cancelledBookings,
            completedBookings,
            totalRevenue,
            monthlyRevenue,
            yearlyRevenue,
            totalReviews,
            averageRating,
            totalRooms,
            availableRooms,
            bookedRooms,
            monthlyBookings,
            yearlyBookings
        ] = await Promise.all([
            Booking.countDocuments({ hotel: hotelId }),
            Booking.countDocuments({ hotel: hotelId, status: 'CONFIRMED' }),
            Booking.countDocuments({ hotel: hotelId, status: 'CANCELLED' }),
            Booking.countDocuments({ hotel: hotelId, status: 'COMPLETED' }),
            Booking.aggregate([
                { $match: { hotel: new mongoose.Types.ObjectId(hotelId), status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Booking.aggregate([
                {
                    $match: {
                        hotel: new mongoose.Types.ObjectId(hotelId),
                        status: 'COMPLETED',
                        createdAt: { $gte: startOfMonth }
                    }
                },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Booking.aggregate([
                {
                    $match: {
                        hotel: new mongoose.Types.ObjectId(hotelId),
                        status: 'COMPLETED',
                        createdAt: { $gte: startOfYear }
                    }
                },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Review.countDocuments({ hotel: hotelId, isVerified: true }),
            Review.aggregate([
                { $match: { hotel: new mongoose.Types.ObjectId(hotelId), isVerified: true } },
                { $group: { _id: null, avg: { $avg: '$rating' } } }
            ]),
            hotel.rooms.length,
            await Room.aggregate([
                { $match: { hotel: new mongoose.Types.ObjectId(hotelId), isActive: true } },
                { $group: { _id: null, total: { $sum: '$availableRooms' } } }
            ]),
            await Booking.countDocuments({
                hotel: hotelId,
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
            }),
            Booking.countDocuments({
                hotel: hotelId,
                createdAt: { $gte: startOfMonth }
            }),
            Booking.countDocuments({
                hotel: hotelId,
                createdAt: { $gte: startOfYear }
            })
        ]);

        // Recent bookings
        const recentBookings = await Booking.find({ hotel: hotelId })
            .populate('user', 'Name email phone')
            .populate('room', 'roomType roomNumber')
            .sort('-createdAt')
            .limit(10);

        // Room occupancy rate
        const occupancyRate = totalRooms > 0 ? ((bookedRooms / totalRooms) * 100).toFixed(1) : 0;

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name,
                status: hotel.status,
                isActive: hotel.isActive,
                starRating: hotel.starRating
            },
            bookingStats: {
                total: totalBookings,
                confirmed: confirmedBookings,
                cancelled: cancelledBookings,
                completed: completedBookings,
                monthly: monthlyBookings,
                yearly: yearlyBookings
            },
            revenueStats: {
                total: totalRevenue[0]?.total || 0,
                monthly: monthlyRevenue[0]?.total || 0,
                yearly: yearlyRevenue[0]?.total || 0
            },
            roomStats: {
                total: totalRooms,
                available: availableRooms[0]?.total || 0,
                booked: bookedRooms,
                occupancyRate: parseFloat(occupancyRate)
            },
            reviewStats: {
                total: totalReviews,
                averageRating: averageRating[0]?.avg || 0
            },
            recentBookings,
            lastUpdated: now
        });
    } catch (error) {
        console.error('Get hotel stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET MY HOTEL BOOKINGS ====================
router.get('/hotels/:hotelId/bookings', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { hotelId } = req.params;
        const {
            page = 1,
            limit = 10,
            status,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
        }

        const query = { hotel: hotelId };

        if (status && status !== 'all') {
            query.status = status;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [bookings, totalCount] = await Promise.all([
            Booking.find(query)
                .populate('user', 'Name email phone')
                .populate('room', 'roomType roomNumber pricePerNight')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Booking.countDocuments(query)
        ]);

        // Calculate summary
        const summary = await Booking.aggregate([
            { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    revenue: { $sum: '$totalPrice' }
                }
            }
        ]);

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name
            },
            summary,
            bookings,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalBookings: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get hotel bookings error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET MY HOTEL REVIEWS ====================
router.get('/hotels/:hotelId/reviews', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { hotelId } = req.params;
        const {
            page = 1,
            limit = 10,
            minRating,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
        }

        const query = { hotel: hotelId };

        if (minRating) {
            query.rating = { $gte: parseInt(minRating) };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [reviews, totalCount] = await Promise.all([
            Review.find(query)
                .populate('user', 'Name profileImage')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Review.countDocuments(query)
        ]);

        // Calculate rating distribution
        const ratingDistribution = await Review.aggregate([
            { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        ratingDistribution.forEach(item => {
            distribution[item._id] = item.count;
        });

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name,
                averageRating: hotel.averageRating,
                totalReviews: hotel.totalReviews
            },
            ratingDistribution: distribution,
            reviews,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalReviews: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get hotel reviews error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL HOTELS (Admin) ====================
router.get('/admin/hotels', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            search,
            status,
            isActive,
            isVerified,
            isFeatured,
            minStarRating,
            maxStarRating,
            ownerId,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        // Search by name or slug
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { slug: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        // Filter by status
        if (status && status !== 'all') {
            query.status = status;
        }

        // Filter by active status
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        // Filter by verification status
        if (isVerified !== undefined) {
            query.isVerified = isVerified === 'true';
        }

        // Filter by featured status
        if (isFeatured !== undefined) {
            query.isFeatured = isFeatured === 'true';
        }

        // Filter by star rating
        if (minStarRating || maxStarRating) {
            query.starRating = {};
            if (minStarRating) query.starRating.$gte = parseInt(minStarRating);
            if (maxStarRating) query.starRating.$lte = parseInt(maxStarRating);
        }

        // Filter by owner
        if (ownerId && mongoose.Types.ObjectId.isValid(ownerId)) {
            query.owner = ownerId;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [hotels, totalCount] = await Promise.all([
            Hotel.find(query)
                .populate('owner', 'Name email phone profileImage businessInfo')
                .populate('rooms', 'roomType pricePerNight capacity')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Hotel.countDocuments(query)
        ]);

        // Get additional stats for each hotel
        const hotelsWithStats = await Promise.all(hotels.map(async (hotel) => {
            const totalRooms = hotel.rooms.length;
            const totalBookings = await Booking.countDocuments({ hotel: hotel._id });
            const totalReviews = await Review.countDocuments({ hotel: hotel._id });

            return {
                ...hotel.toObject(),
                stats: {
                    totalRooms,
                    totalBookings,
                    totalReviews
                }
            };
        }));

        res.json({
            hotels: hotelsWithStats,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalHotels: totalCount,
                limit: parseInt(limit)
            },
            filters: {
                status: status || 'all',
                isActive: isActive !== undefined ? isActive === 'true' : null,
                isVerified: isVerified !== undefined ? isVerified === 'true' : null,
                isFeatured: isFeatured !== undefined ? isFeatured === 'true' : null
            }
        });
    } catch (error) {
        console.error('Get all hotels admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE HOTEL (Admin) ====================
router.get('/admin/hotels/:hotelId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId)
            .populate('owner', 'Name email phone profileImage businessInfo address hotels')
            .populate('rooms', 'roomType roomNumber pricePerNight capacity amenities images')
            .populate({
                path: 'reviews',
                populate: {
                    path: 'user',
                    select: 'Name email profileImage'
                }
            });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        // Get additional statistics
        const totalBookings = await Booking.countDocuments({ hotel: hotelId });
        const activeBookings = await Booking.countDocuments({
            hotel: hotelId,
            status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
        });
        const totalRevenue = await Booking.aggregate([
            { $match: { hotel: new mongoose.Types.ObjectId(hotelId), status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } }
        ]);

        const hotelWithStats = {
            ...hotel.toObject(),
            adminStats: {
                totalBookings,
                activeBookings,
                totalRevenue: totalRevenue[0]?.total || 0
            }
        };

        res.json(hotelWithStats);
    } catch (error) {
        console.error('Get single hotel admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== APPROVE HOTEL ====================
router.patch('/admin/hotels/:hotelId/approve', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can approve hotels
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        hotel.status = 'APPROVED';
        hotel.isActive = true;
        await hotel.save();

        res.json({
            message: 'Hotel approved successfully',
            hotel: {
                id: hotel._id,
                name: hotel.name,
                status: hotel.status,
                isActive: hotel.isActive
            }
        });
    } catch (error) {
        console.error('Approve hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== REJECT HOTEL ====================
router.patch('/admin/hotels/:hotelId/reject', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can reject hotels
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelId } = req.params;
        const { rejectionReason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        hotel.status = 'REJECTED';
        hotel.isActive = false;
        hotel.rejectionReason = rejectionReason || 'No reason provided';
        await hotel.save();

        res.json({
            message: 'Hotel rejected successfully',
            hotel: {
                id: hotel._id,
                name: hotel.name,
                status: hotel.status,
                rejectionReason: hotel.rejectionReason
            }
        });
    } catch (error) {
        console.error('Reject hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SUSPEND HOTEL ====================
router.patch('/admin/hotels/:hotelId/suspend', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can suspend hotels
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { hotelId } = req.params;
        const { suspensionReason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        hotel.status = 'SUSPENDED';
        hotel.isActive = false;
        hotel.suspensionReason = suspensionReason || 'Violation of terms';
        await hotel.save();

        res.json({
            message: 'Hotel suspended successfully',
            hotel: {
                id: hotel._id,
                name: hotel.name,
                status: hotel.status,
                suspensionReason: hotel.suspensionReason
            }
        });
    } catch (error) {
        console.error('Suspend hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ACTIVATE HOTEL ====================
router.patch('/admin/hotels/:hotelId/activate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can activate hotels
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        // Can only activate APPROVED hotels
        if (hotel.status !== 'APPROVED') {
            return res.status(400).json({ error: 'Only approved hotels can be activated' });
        }

        hotel.isActive = true;
        await hotel.save();

        res.json({
            message: 'Hotel activated successfully',
            hotel: {
                id: hotel._id,
                name: hotel.name,
                isActive: hotel.isActive
            }
        });
    } catch (error) {
        console.error('Activate hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DEACTIVATE HOTEL ====================
router.patch('/admin/hotels/:hotelId/deactivate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can deactivate hotels
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        // Check for active bookings
        const activeBookings = await Booking.countDocuments({
            hotel: hotelId,
            status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({
                error: `Cannot deactivate hotel with ${activeBookings} active bookings`
            });
        }

        hotel.isActive = false;
        await hotel.save();

        res.json({
            message: 'Hotel deactivated successfully',
            hotel: {
                id: hotel._id,
                name: hotel.name,
                isActive: hotel.isActive
            }
        });
    } catch (error) {
        console.error('Deactivate hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== VERIFY HOTEL ====================
router.patch('/admin/hotels/:hotelId/verify', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can verify hotels
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        hotel.isVerified = true;
        await hotel.save();

        res.json({
            message: 'Hotel verified successfully',
            hotel: {
                id: hotel._id,
                name: hotel.name,
                isVerified: hotel.isVerified
            }
        });
    } catch (error) {
        console.error('Verify hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MAKE FEATURED HOTEL ====================
router.patch('/admin/hotels/:hotelId/featured', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can feature hotels
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        // Only approved and active hotels can be featured
        if (hotel.status !== 'APPROVED' || !hotel.isActive) {
            return res.status(400).json({ error: 'Only approved and active hotels can be featured' });
        }

        hotel.isFeatured = true;
        await hotel.save();

        res.json({
            message: 'Hotel marked as featured successfully',
            hotel: {
                id: hotel._id,
                name: hotel.name,
                isFeatured: hotel.isFeatured
            }
        });
    } catch (error) {
        console.error('Make featured hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== REMOVE FEATURED HOTEL ====================
router.patch('/admin/hotels/:hotelId/remove-featured', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can remove featured status
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        hotel.isFeatured = false;
        await hotel.save();

        res.json({
            message: 'Featured status removed successfully',
            hotel: {
                id: hotel._id,
                name: hotel.name,
                isFeatured: hotel.isFeatured
            }
        });
    } catch (error) {
        console.error('Remove featured hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE ANY HOTEL ====================
router.put('/admin/hotels/:hotelId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can update any hotel
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const {
            name,
            description,
            contact,
            address,
            location,
            starRating,
            amenities,
            policies,
            status,
            isActive,
            isVerified,
            isFeatured,
            thumbnail,
            images
        } = req.body;

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        // Update fields
        if (name) hotel.name = name;
        if (description) hotel.description = description;
        if (contact) hotel.contact = contact;
        if (address) hotel.address = address;
        if (location) hotel.location = location;
        if (starRating) hotel.starRating = starRating;
        if (amenities) hotel.amenities = amenities;
        if (policies) hotel.policies = policies;
        if (status) hotel.status = status;
        if (isActive !== undefined) hotel.isActive = isActive;
        if (isVerified !== undefined) hotel.isVerified = isVerified;
        if (isFeatured !== undefined) hotel.isFeatured = isFeatured;
        if (thumbnail) hotel.thumbnail = thumbnail;
        if (images) hotel.images = images;

        await hotel.save();

        const updatedHotel = await Hotel.findById(hotelId)
            .populate('owner', 'Name email phone');

        res.json({
            message: 'Hotel updated successfully by admin',
            hotel: updatedHotel
        });
    } catch (error) {
        console.error('Update any hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE ANY HOTEL ====================
router.delete('/admin/hotels/:hotelId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can delete hotels
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId);

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        // Check for active bookings
        const activeBookings = await Booking.countDocuments({
            hotel: hotelId,
            status: { $in: ['CONFIRMED', 'PENDING', 'CHECKED_IN'] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({
                error: `Cannot delete hotel with ${activeBookings} active bookings. Cancel them first.`
            });
        }

        // Remove hotel reference from owner
        await User.findByIdAndUpdate(hotel.owner, {
            $pull: { hotels: hotelId }
        });

        // Delete all associated rooms
        await Room.deleteMany({ hotel: hotelId });

        // Delete all reviews
        await Review.deleteMany({ hotel: hotelId });

        // Delete all bookings
        await Booking.deleteMany({ hotel: hotelId });

        // Delete the hotel
        await Hotel.findByIdAndDelete(hotelId);

        res.json({
            message: 'Hotel permanently deleted successfully',
            deletedHotel: {
                id: hotel._id,
                name: hotel.name,
                owner: hotel.owner
            }
        });
    } catch (error) {
        console.error('Delete any hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET PENDING HOTELS ====================
router.get('/admin/hotels/pending', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view pending hotels
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = { status: 'PENDING' };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [hotels, totalCount] = await Promise.all([
            Hotel.find(query)
                .populate('owner', 'Name email phone profileImage')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Hotel.countDocuments(query)
        ]);

        res.json({
            pendingHotels: hotels,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalPending: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get pending hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET REJECTED HOTELS ====================
router.get('/admin/hotels/rejected', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view rejected hotels
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            sortBy = 'updatedAt',
            sortOrder = 'desc'
        } = req.query;

        const query = { status: 'REJECTED' };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [hotels, totalCount] = await Promise.all([
            Hotel.find(query)
                .populate('owner', 'Name email phone')
                .select('name owner rejectionReason createdAt updatedAt')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Hotel.countDocuments(query)
        ]);

        res.json({
            rejectedHotels: hotels,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalRejected: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get rejected hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SUSPENDED HOTELS ====================
router.get('/admin/hotels/suspended', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view suspended hotels
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const {
            page = 1,
            limit = 10,
            sortBy = 'updatedAt',
            sortOrder = 'desc'
        } = req.query;

        const query = { status: 'SUSPENDED' };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [hotels, totalCount] = await Promise.all([
            Hotel.find(query)
                .populate('owner', 'Name email phone')
                .select('name owner suspensionReason createdAt updatedAt')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Hotel.countDocuments(query)
        ]);

        res.json({
            suspendedHotels: hotels,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalSuspended: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get suspended hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET HOTEL STATISTICS (Admin Dashboard) ====================
router.get('/admin/hotels/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view statistics
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        const [
            totalHotels,
            activeHotels,
            inactiveHotels,
            pendingHotels,
            approvedHotels,
            rejectedHotels,
            suspendedHotels,
            verifiedHotels,
            unverifiedHotels,
            featuredHotels,
            totalRooms,
            totalBookings,
            totalRevenue,
            monthlyNewHotels,
            yearlyNewHotels,
            hotelsByStarRating,
            hotelsByStatus,
            topHotelsByBookings,
            topHotelsByRevenue
        ] = await Promise.all([
            Hotel.countDocuments(),
            Hotel.countDocuments({ isActive: true }),
            Hotel.countDocuments({ isActive: false }),
            Hotel.countDocuments({ status: 'PENDING' }),
            Hotel.countDocuments({ status: 'APPROVED' }),
            Hotel.countDocuments({ status: 'REJECTED' }),
            Hotel.countDocuments({ status: 'SUSPENDED' }),
            Hotel.countDocuments({ isVerified: true }),
            Hotel.countDocuments({ isVerified: false }),
            Hotel.countDocuments({ isFeatured: true }),
            Room.countDocuments(),
            Booking.countDocuments(),
            Booking.aggregate([
                { $match: { status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Hotel.countDocuments({ createdAt: { $gte: startOfMonth } }),
            Hotel.countDocuments({ createdAt: { $gte: startOfYear } }),
            Hotel.aggregate([
                { $group: { _id: '$starRating', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Hotel.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Booking.aggregate([
                { $group: { _id: '$hotel', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 },
                { $lookup: { from: 'hotels', localField: '_id', foreignField: '_id', as: 'hotel' } },
                { $unwind: '$hotel' }
            ]),
            Booking.aggregate([
                { $match: { status: 'COMPLETED' } },
                { $group: { _id: '$hotel', revenue: { $sum: '$totalPrice' } } },
                { $sort: { revenue: -1 } },
                { $limit: 5 },
                { $lookup: { from: 'hotels', localField: '_id', foreignField: '_id', as: 'hotel' } },
                { $unwind: '$hotel' }
            ])
        ]);

        // Format star rating distribution
        const starRatingDistribution = {
            1: 0, 2: 0, 3: 0, 4: 0, 5: 0
        };
        hotelsByStarRating.forEach(item => {
            starRatingDistribution[item._id] = item.count;
        });

        // Format status distribution
        const statusDistribution = {};
        hotelsByStatus.forEach(item => {
            statusDistribution[item._id] = item.count;
        });

        // Calculate approval rate
        const totalProcessed = approvedHotels + rejectedHotels;
        const approvalRate = totalProcessed > 0 ? ((approvedHotels / totalProcessed) * 100).toFixed(1) : 0;

        // Calculate active percentage
        const activePercentage = totalHotels > 0 ? ((activeHotels / totalHotels) * 100).toFixed(1) : 0;
        const verifiedPercentage = totalHotels > 0 ? ((verifiedHotels / totalHotels) * 100).toFixed(1) : 0;

        res.json({
            overview: {
                totalHotels,
                activeHotels,
                inactiveHotels,
                activePercentage: parseFloat(activePercentage),
                verifiedPercentage: parseFloat(verifiedPercentage),
                totalRooms,
                totalBookings,
                totalRevenue: totalRevenue[0]?.total || 0
            },
            statusBreakdown: {
                pending: pendingHotels,
                approved: approvedHotels,
                rejected: rejectedHotels,
                suspended: suspendedHotels,
                approvalRate: parseFloat(approvalRate),
                distribution: statusDistribution
            },
            verification: {
                verified: verifiedHotels,
                unverified: unverifiedHotels,
                featured: featuredHotels
            },
            starRatingDistribution,
            hotelGrowth: {
                thisMonth: monthlyNewHotels,
                thisYear: yearlyNewHotels
            },
            topPerformers: {
                byBookings: topHotelsByBookings.map(item => ({
                    hotelId: item._id,
                    name: item.hotel.name,
                    bookings: item.count
                })),
                byRevenue: topHotelsByRevenue.map(item => ({
                    hotelId: item._id,
                    name: item.hotel.name,
                    revenue: item.revenue
                }))
            },
            timestamp: now
        });
    } catch (error) {
        console.error('Get hotel statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK APPROVE HOTELS ====================
router.post('/admin/hotels/bulk-approve', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can bulk approve
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelIds } = req.body;

        if (!hotelIds || !Array.isArray(hotelIds) || hotelIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of hotel IDs' });
        }

        // Validate all hotel IDs
        const validIds = hotelIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validIds.length !== hotelIds.length) {
            return res.status(400).json({ error: 'One or more hotel IDs are invalid' });
        }

        const result = await Hotel.updateMany(
            {
                _id: { $in: validIds },
                status: { $in: ['PENDING', 'REJECTED'] }
            },
            {
                $set: {
                    status: 'APPROVED',
                    isActive: true
                }
            }
        );

        res.json({
            message: `Successfully approved ${result.modifiedCount} hotels`,
            statistics: {
                requested: hotelIds.length,
                approved: result.modifiedCount,
                failed: hotelIds.length - result.modifiedCount
            }
        });
    } catch (error) {
        console.error('Bulk approve hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK REJECT HOTELS ====================
router.post('/admin/hotels/bulk-reject', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can bulk reject
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelIds, rejectionReason } = req.body;

        if (!hotelIds || !Array.isArray(hotelIds) || hotelIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of hotel IDs' });
        }

        const validIds = hotelIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        const result = await Hotel.updateMany(
            {
                _id: { $in: validIds },
                status: { $in: ['PENDING', 'APPROVED'] }
            },
            {
                $set: {
                    status: 'REJECTED',
                    isActive: false,
                    rejectionReason: rejectionReason || 'Bulk rejected by admin'
                }
            }
        );

        res.json({
            message: `Successfully rejected ${result.modifiedCount} hotels`,
            statistics: {
                requested: hotelIds.length,
                rejected: result.modifiedCount,
                failed: hotelIds.length - result.modifiedCount
            }
        });
    } catch (error) {
        console.error('Bulk reject hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK SUSPEND HOTELS ====================
router.post('/admin/hotels/bulk-suspend', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can bulk suspend
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { hotelIds, suspensionReason } = req.body;

        if (!hotelIds || !Array.isArray(hotelIds) || hotelIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of hotel IDs' });
        }

        const validIds = hotelIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        // Check for active bookings before suspension
        const hotelsWithBookings = [];
        for (const hotelId of validIds) {
            const activeBookings = await Booking.countDocuments({
                hotel: hotelId,
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
            });
            if (activeBookings > 0) {
                hotelsWithBookings.push({ hotelId, activeBookings });
            }
        }

        if (hotelsWithBookings.length > 0) {
            return res.status(400).json({
                error: 'Some hotels have active bookings',
                hotelsWithActiveBookings: hotelsWithBookings
            });
        }

        const result = await Hotel.updateMany(
            { _id: { $in: validIds } },
            {
                $set: {
                    status: 'SUSPENDED',
                    isActive: false,
                    suspensionReason: suspensionReason || 'Bulk suspended by SUPER_ADMIN'
                }
            }
        );

        res.json({
            message: `Successfully suspended ${result.modifiedCount} hotels`,
            statistics: {
                requested: hotelIds.length,
                suspended: result.modifiedCount,
                failed: hotelIds.length - result.modifiedCount
            }
        });
    } catch (error) {
        console.error('Bulk suspend hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL HOTEL ANALYTICS ====================
router.get('/admin/hotels/analytics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view analytics
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            startDate,
            endDate,
            groupBy = 'day' // day, week, month, year
        } = req.query;

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        // Hotel growth over time
        let dateGroupFormat;
        switch (groupBy) {
            case 'week':
                dateGroupFormat = { $week: '$createdAt' };
                break;
            case 'month':
                dateGroupFormat = { $month: '$createdAt' };
                break;
            case 'year':
                dateGroupFormat = { $year: '$createdAt' };
                break;
            default:
                dateGroupFormat = { $dayOfMonth: '$createdAt' };
        }

        const [
            totalHotels,
            hotelsByStatus,
            hotelsByStarRating,
            hotelsByAmenities,
            hotelsByLocation,
            hotelsGrowth,
            bookingTrends,
            revenueTrends,
            topPerformingHotels,
            worstPerformingHotels,
            averageOccupancyRate,
            averageRatingTrend,
            mostReviewedHotels,
            hotelsWithNoBookings,
            hotelsWithNoReviews
        ] = await Promise.all([
            Hotel.countDocuments(),
            Hotel.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Hotel.aggregate([
                { $group: { _id: '$starRating', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Hotel.aggregate([
                { $unwind: '$amenities' },
                { $group: { _id: '$amenities', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            Hotel.aggregate([
                {
                    $group: {
                        _id: { city: '$address.city', country: '$address.country' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            Hotel.aggregate([
                { $match: dateFilter },
                {
                    $group: {
                        _id: dateGroupFormat,
                        count: { $sum: 1 },
                        avgStarRating: { $avg: '$starRating' }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            Booking.aggregate([
                { $match: dateFilter },
                {
                    $group: {
                        _id: dateGroupFormat,
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$totalPrice' }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            Booking.aggregate([
                { $match: { ...dateFilter, status: 'COMPLETED' } },
                {
                    $group: {
                        _id: dateGroupFormat,
                        revenue: { $sum: '$totalPrice' }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            Hotel.aggregate([
                { $match: { status: 'APPROVED', isActive: true } },
                {
                    $lookup: {
                        from: 'bookings',
                        localField: '_id',
                        foreignField: 'hotel',
                        as: 'bookings'
                    }
                },
                { $addFields: { bookingCount: { $size: '$bookings' } } },
                { $sort: { bookingCount: -1 } },
                { $limit: 10 },
                { $project: { name: 1, starRating: 1, bookingCount: 1, averageRating: 1 } }
            ]),
            Hotel.aggregate([
                { $match: { status: 'APPROVED', totalReviews: { $gt: 0 } } },
                { $sort: { averageRating: 1 } },
                { $limit: 10 },
                { $project: { name: 1, starRating: 1, averageRating: 1, totalReviews: 1 } }
            ]),
            Booking.aggregate([
                {
                    $group: {
                        _id: '$hotel',
                        totalBookings: { $sum: 1 },
                        totalRoomsBooked: { $sum: '$numberOfRooms' }
                    }
                },
                {
                    $lookup: {
                        from: 'hotels',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'hotel'
                    }
                },
                { $unwind: '$hotel' },
                {
                    $group: {
                        _id: null,
                        avgOccupancy: { $avg: { $divide: ['$totalRoomsBooked', { $size: '$hotel.rooms' }] } }
                    }
                }
            ]),
            Review.aggregate([
                { $match: dateFilter },
                {
                    $group: {
                        _id: dateGroupFormat,
                        avgRating: { $avg: '$rating' },
                        totalReviews: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            Hotel.aggregate([
                { $match: { totalReviews: { $gt: 0 } } },
                { $sort: { totalReviews: -1 } },
                { $limit: 10 },
                { $project: { name: 1, totalReviews: 1, averageRating: 1 } }
            ]),
            Hotel.aggregate([
                {
                    $lookup: {
                        from: 'bookings',
                        localField: '_id',
                        foreignField: 'hotel',
                        as: 'bookings'
                    }
                },
                { $match: { bookings: { $size: 0 } } },
                { $project: { name: 1, owner: 1, createdAt: 1 } }
            ]),
            Hotel.aggregate([
                { $match: { totalReviews: 0 } },
                { $project: { name: 1, owner: 1, createdAt: 1 } }
            ])
        ]);

        // Calculate conversion metrics
        const approvedHotels = hotelsByStatus.find(h => h._id === 'APPROVED')?.count || 0;
        const pendingHotels = hotelsByStatus.find(h => h._id === 'PENDING')?.count || 0;
        const conversionRate = (approvedHotels / (approvedHotels + pendingHotels)) * 100;

        res.json({
            overview: {
                totalHotels,
                approvedHotels,
                pendingHotels,
                conversionRate: conversionRate.toFixed(2),
                averageOccupancyRate: (averageOccupancyRate[0]?.avgOccupancy * 100).toFixed(2) || 0
            },
            distribution: {
                byStatus: hotelsByStatus,
                byStarRating: hotelsByStarRating,
                topAmenities: hotelsByAmenities,
                topLocations: hotelsByLocation
            },
            trends: {
                hotelGrowth: hotelsGrowth,
                bookingTrends: bookingTrends,
                revenueTrends: revenueTrends,
                ratingTrends: averageRatingTrend
            },
            performance: {
                topPerforming: topPerformingHotels,
                worstPerforming: worstPerformingHotels,
                mostReviewed: mostReviewedHotels,
                noBookings: hotelsWithNoBookings.length,
                noReviews: hotelsWithNoReviews.length
            },
            filters: {
                startDate: startDate || null,
                endDate: endDate || null,
                groupBy
            }
        });
    } catch (error) {
        console.error('Get hotel analytics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MANAGE HOTEL VERIFICATION ====================
router.post('/admin/hotels/verify', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can verify hotels
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { hotelIds, verificationStatus } = req.body;

        if (!hotelIds || !Array.isArray(hotelIds) || hotelIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of hotel IDs' });
        }

        if (verificationStatus === undefined) {
            return res.status(400).json({ error: 'Please provide verification status (true/false)' });
        }

        const validIds = hotelIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        const result = await Hotel.updateMany(
            { _id: { $in: validIds } },
            { $set: { isVerified: verificationStatus } }
        );

        res.json({
            message: `Successfully updated verification status for ${result.modifiedCount} hotels`,
            statistics: {
                requested: hotelIds.length,
                updated: result.modifiedCount,
                verificationStatus: verificationStatus ? 'Verified' : 'Unverified'
            }
        });
    } catch (error) {
        console.error('Manage hotel verification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MANAGE FEATURED HOTELS ====================
router.post('/admin/hotels/featured', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can manage featured hotels
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelIds, featuredStatus } = req.body;

        if (!hotelIds || !Array.isArray(hotelIds) || hotelIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of hotel IDs' });
        }

        if (featuredStatus === undefined) {
            return res.status(400).json({ error: 'Please provide featured status (true/false)' });
        }

        const validIds = hotelIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        // Only allow featured status for approved and active hotels
        if (featuredStatus === true) {
            const result = await Hotel.updateMany(
                {
                    _id: { $in: validIds },
                    status: 'APPROVED',
                    isActive: true
                },
                { $set: { isFeatured: true } }
            );

            res.json({
                message: `Successfully marked ${result.modifiedCount} hotels as featured`,
                statistics: {
                    requested: hotelIds.length,
                    featured: result.modifiedCount,
                    failed: hotelIds.length - result.modifiedCount
                }
            });
        } else {
            const result = await Hotel.updateMany(
                { _id: { $in: validIds } },
                { $set: { isFeatured: false } }
            );

            res.json({
                message: `Successfully removed featured status from ${result.modifiedCount} hotels`,
                statistics: {
                    requested: hotelIds.length,
                    removed: result.modifiedCount,
                    failed: hotelIds.length - result.modifiedCount
                }
            });
        }
    } catch (error) {
        console.error('Manage featured hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE MULTIPLE HOTELS ====================
router.post('/admin/hotels/bulk-delete', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can delete multiple hotels
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { hotelIds, permanent = false } = req.body;

        if (!hotelIds || !Array.isArray(hotelIds) || hotelIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of hotel IDs' });
        }

        const validIds = hotelIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        // Check for active bookings
        const hotelsWithActiveBookings = [];
        for (const hotelId of validIds) {
            const activeBookings = await Booking.countDocuments({
                hotel: hotelId,
                status: { $in: ['CONFIRMED', 'PENDING', 'CHECKED_IN'] }
            });
            if (activeBookings > 0) {
                hotelsWithActiveBookings.push({ hotelId, activeBookings });
            }
        }

        if (hotelsWithActiveBookings.length > 0) {
            return res.status(400).json({
                error: 'Some hotels have active bookings',
                hotelsWithActiveBookings
            });
        }

        let deletedCount = 0;
        const failedDeletions = [];

        if (permanent) {
            // Permanent deletion
            for (const hotelId of validIds) {
                try {
                    const hotel = await Hotel.findById(hotelId);
                    if (hotel) {
                        // Remove from user
                        await User.findByIdAndUpdate(hotel.owner, {
                            $pull: { hotels: hotelId }
                        });

                        // Delete associated data
                        await Room.deleteMany({ hotel: hotelId });
                        await Review.deleteMany({ hotel: hotelId });
                        await Booking.deleteMany({ hotel: hotelId });
                        await Hotel.findByIdAndDelete(hotelId);

                        deletedCount++;
                    }
                } catch (error) {
                    failedDeletions.push({ hotelId, error: error.message });
                }
            }
        } else {
            // Soft delete - suspend all
            const result = await Hotel.updateMany(
                { _id: { $in: validIds } },
                {
                    $set: {
                        status: 'SUSPENDED',
                        isActive: false,
                        suspensionReason: 'Bulk deleted by SUPER_ADMIN'
                    }
                }
            );
            deletedCount = result.modifiedCount;
        }

        res.json({
            message: permanent ? `Successfully deleted ${deletedCount} hotels permanently` : `Successfully suspended ${deletedCount} hotels`,
            statistics: {
                requested: hotelIds.length,
                processed: deletedCount,
                failed: failedDeletions.length
            },
            failedDeletions: failedDeletions.length > 0 ? failedDeletions : undefined
        });
    } catch (error) {
        console.error('Delete multiple hotels error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SYSTEM HOTEL STATISTICS ====================
router.get('/admin/hotels/system-stats', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view system statistics
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const [
            totalHotels,
            totalUsers,
            totalOwners,
            hotelsPerOwner,
            totalRooms,
            totalRoomTypes,
            averagePricePerNight,
            totalReviews,
            averageHotelRating,
            totalBookingsAllTime,
            totalRevenueAllTime,
            hotelsByMonth,
            activeVsInactive,
            verifiedVsUnverified,
            featuredVsNonFeatured,
            topOwnersByHotels,
            hotelsWithMostRooms,
            hotelsWithHighestRating,
            bookingSuccessRate,
            cancellationRate
        ] = await Promise.all([
            Hotel.countDocuments(),
            User.countDocuments(),
            User.countDocuments({ hotels: { $exists: true, $ne: [] } }),
            Hotel.aggregate([
                { $group: { _id: '$owner', count: { $sum: 1 } } },
                { $group: { _id: null, avg: { $avg: '$count' }, max: { $max: '$count' } } }
            ]),
            Room.countDocuments(),
            Room.aggregate([
                { $group: { _id: '$roomType', count: { $sum: 1 } } }
            ]),
            Room.aggregate([
                { $group: { _id: null, avg: { $avg: '$pricePerNight' } } }
            ]),
            Review.countDocuments(),
            Hotel.aggregate([
                { $group: { _id: null, avg: { $avg: '$averageRating' } } }
            ]),
            Booking.countDocuments(),
            Booking.aggregate([
                { $match: { status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Hotel.aggregate([
                {
                    $group: {
                        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 12 }
            ]),
            Hotel.aggregate([
                { $group: { _id: '$isActive', count: { $sum: 1 } } }
            ]),
            Hotel.aggregate([
                { $group: { _id: '$isVerified', count: { $sum: 1 } } }
            ]),
            Hotel.aggregate([
                { $group: { _id: '$isFeatured', count: { $sum: 1 } } }
            ]),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                { $project: { Name: 1, email: 1, hotelCount: { $size: '$hotels' } } },
                { $sort: { hotelCount: -1 } },
                { $limit: 10 }
            ]),
            Hotel.aggregate([
                { $project: { name: 1, roomCount: { $size: '$rooms' } } },
                { $sort: { roomCount: -1 } },
                { $limit: 10 }
            ]),
            Hotel.aggregate([
                { $match: { totalReviews: { $gt: 0 } } },
                { $project: { name: 1, averageRating: 1, totalReviews: 1 } },
                { $sort: { averageRating: -1 } },
                { $limit: 10 }
            ]),
            Booking.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ])
        ]);

        const completedBookings = bookingSuccessRate?.find(b => b._id === 'COMPLETED')?.count || 0;
        const cancelledBookings = cancellationRate?.find(b => b._id === 'CANCELLED')?.count || 0;
        const totalProcessed = completedBookings + cancelledBookings;

        const successRate = totalProcessed > 0 ? (completedBookings / totalProcessed) * 100 : 0;
        const cancelRate = totalProcessed > 0 ? (cancelledBookings / totalProcessed) * 100 : 0;

        res.json({
            systemOverview: {
                totalHotels,
                totalUsers,
                totalHotelOwners: totalOwners,
                averageHotelsPerOwner: hotelsPerOwner[0]?.avg.toFixed(2) || 0,
                maxHotelsBySingleOwner: hotelsPerOwner[0]?.max || 0,
                totalRooms,
                roomTypeDistribution: totalRoomTypes,
                averageRoomPrice: averagePricePerNight[0]?.avg.toFixed(2) || 0,
                totalReviews,
                averageHotelRating: averageHotelRating[0]?.avg.toFixed(2) || 0,
                totalBookings: totalBookingsAllTime,
                totalRevenue: totalRevenueAllTime[0]?.total || 0
            },
            statusBreakdown: {
                active: activeVsInactive.find(a => a._id === true)?.count || 0,
                inactive: activeVsInactive.find(a => a._id === false)?.count || 0,
                verified: verifiedVsUnverified.find(v => v._id === true)?.count || 0,
                unverified: verifiedVsUnverified.find(v => v._id === false)?.count || 0,
                featured: featuredVsNonFeatured.find(f => f._id === true)?.count || 0,
                nonFeatured: featuredVsNonFeatured.find(f => f._id === false)?.count || 0
            },
            performance: {
                bookingSuccessRate: successRate.toFixed(2),
                cancellationRate: cancelRate.toFixed(2),
                bookingStatusDistribution: bookingSuccessRate
            },
            leaders: {
                topOwnersByHotels: topOwnersByHotels,
                hotelsWithMostRooms: hotelsWithMostRooms,
                hotelsWithHighestRating: hotelsWithHighestRating
            },
            trends: {
                hotelsAddedLast12Months: hotelsByMonth
            },
            generatedAt: new Date()
        });
    } catch (error) {
        console.error('Get system hotel stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== HOTEL PERFORMANCE REPORT ====================
router.get('/admin/hotels/performance-report', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view performance reports
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            startDate,
            endDate,
            minRating,
            minBookings,
            sortBy = 'revenue',
            limit = 20
        } = req.query;

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        const matchStage = {};
        if (minRating) matchStage.averageRating = { $gte: parseFloat(minRating) };
        if (minBookings) matchStage.totalBookings = { $gte: parseInt(minBookings) };

        const hotels = await Hotel.aggregate([
            { $match: { status: 'APPROVED', ...matchStage } },
            {
                $lookup: {
                    from: 'bookings',
                    localField: '_id',
                    foreignField: 'hotel',
                    as: 'allBookings'
                }
            },
            {
                $lookup: {
                    from: 'reviews',
                    localField: '_id',
                    foreignField: 'hotel',
                    as: 'allReviews'
                }
            },
            {
                $addFields: {
                    totalBookingsCount: { $size: '$allBookings' },
                    completedBookings: {
                        $size: {
                            $filter: {
                                input: '$allBookings',
                                cond: { $eq: ['$$this.status', 'COMPLETED'] }
                            }
                        }
                    },
                    cancelledBookings: {
                        $size: {
                            $filter: {
                                input: '$allBookings',
                                cond: { $eq: ['$$this.status', 'CANCELLED'] }
                            }
                        }
                    },
                    totalRevenue: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: '$allBookings',
                                        cond: { $eq: ['$$this.status', 'COMPLETED'] }
                                    }
                                },
                                as: 'booking',
                                in: '$$booking.totalPrice'
                            }
                        }
                    },
                    averageReviewRating: { $avg: '$allReviews.rating' }
                }
            },
            {
                $addFields: {
                    occupancyRate: {
                        $multiply: [
                            { $divide: ['$completedBookings', { $ifNull: ['$totalBookingsCount', 1] }] },
                            100
                        ]
                    },
                    revenuePerBooking: {
                        $cond: [
                            { $eq: ['$completedBookings', 0] },
                            0,
                            { $divide: ['$totalRevenue', '$completedBookings'] }
                        ]
                    }
                }
            },
            { $sort: { [sortBy]: -1 } },
            { $limit: parseInt(limit) },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    starRating: 1,
                    isFeatured: 1,
                    isVerified: 1,
                    owner: 1,
                    totalBookings: '$totalBookingsCount',
                    completedBookings: 1,
                    cancelledBookings: 1,
                    totalRevenue: 1,
                    averageRating: '$averageRating',
                    averageReviewRating: 1,
                    occupancyRate: 1,
                    revenuePerBooking: 1,
                    totalReviews: { $size: '$allReviews' }
                }
            }
        ]);

        // Populate owner details
        const populatedHotels = await Hotel.populate(hotels, {
            path: 'owner',
            select: 'Name email phone'
        });

        // Calculate summary statistics
        const summary = {
            totalHotelsInReport: hotels.length,
            totalRevenue: hotels.reduce((sum, h) => sum + (h.totalRevenue || 0), 0),
            averageOccupancy: hotels.reduce((sum, h) => sum + (h.occupancyRate || 0), 0) / hotels.length,
            averageRating: hotels.reduce((sum, h) => sum + (h.averageRating || 0), 0) / hotels.length,
            totalBookings: hotels.reduce((sum, h) => sum + (h.totalBookings || 0), 0),
            topPerformer: hotels[0]?.name || 'N/A'
        };

        res.json({
            report: {
                generatedAt: new Date(),
                dateRange: { startDate: startDate || 'All time', endDate: endDate || 'Present' },
                summary,
                hotels: populatedHotels
            }
        });
    } catch (error) {
        console.error('Hotel performance report error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL HOTEL OWNERS ====================
router.get('/admin/hotel-owners', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view hotel owners
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            search,
            sortBy = 'totalHotels',
            sortOrder = 'desc',
            isActive,
            isVerified
        } = req.query;

        const matchStage = { hotels: { $exists: true, $ne: [] } };

        if (isActive !== undefined) matchStage.isActive = isActive === 'true';
        if (isVerified !== undefined) matchStage.isVerified = isVerified === 'true';

        if (search) {
            matchStage.$or = [
                { Name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const pipeline = [
            { $match: matchStage },
            {
                $lookup: {
                    from: 'hotels',
                    localField: 'hotels',
                    foreignField: '_id',
                    as: 'hotelDetails'
                }
            },
            {
                $addFields: {
                    totalHotels: { $size: '$hotelDetails' },
                    approvedHotels: {
                        $size: {
                            $filter: {
                                input: '$hotelDetails',
                                cond: { $eq: ['$$this.status', 'APPROVED'] }
                            }
                        }
                    },
                    pendingHotels: {
                        $size: {
                            $filter: {
                                input: '$hotelDetails',
                                cond: { $eq: ['$$this.status', 'PENDING'] }
                            }
                        }
                    },
                    rejectedHotels: {
                        $size: {
                            $filter: {
                                input: '$hotelDetails',
                                cond: { $eq: ['$$this.status', 'REJECTED'] }
                            }
                        }
                    },
                    suspendedHotels: {
                        $size: {
                            $filter: {
                                input: '$hotelDetails',
                                cond: { $eq: ['$$this.status', 'SUSPENDED'] }
                            }
                        }
                    },
                    activeHotels: {
                        $size: {
                            $filter: {
                                input: '$hotelDetails',
                                cond: { $eq: ['$$this.isActive', true] }
                            }
                        }
                    },
                    totalRevenue: {
                        $sum: {
                            $map: {
                                input: '$hotelDetails',
                                as: 'hotel',
                                in: { $ifNull: ['$$hotel.totalRevenue', 0] }
                            }
                        }
                    },
                    totalBookings: {
                        $sum: {
                            $map: {
                                input: '$hotelDetails',
                                as: 'hotel',
                                in: { $ifNull: ['$$hotel.totalBookings', 0] }
                            }
                        }
                    },
                    totalRooms: {
                        $sum: {
                            $map: {
                                input: '$hotelDetails',
                                as: 'hotel',
                                in: { $size: { $ifNull: ['$$hotel.rooms', []] } }
                            }
                        }
                    },
                    averageHotelRating: { $avg: '$hotelDetails.averageRating' }
                }
            },
            { $sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 } },
            { $skip: (parseInt(page) - 1) * parseInt(limit) },
            { $limit: parseInt(limit) },
            {
                $project: {
                    password: 0,
                    refreshToken: 0,
                    resetPasswordToken: 0,
                    resetPasswordExpiry: 0,
                    emailVerificationToken: 0,
                    emailVerificationExpiry: 0
                }
            }
        ];

        const [owners, totalCount] = await Promise.all([
            User.aggregate(pipeline),
            User.countDocuments(matchStage)
        ]);

        res.json({
            owners,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalOwners: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get hotel owners error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE HOTEL OWNER DETAILS ====================
router.get('/admin/hotel-owners/:ownerId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view hotel owner details
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { ownerId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            return res.status(400).json({ error: 'Invalid owner ID' });
        }

        const owner = await User.findById(ownerId)
            .select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry')
            .populate({
                path: 'hotels',
                select: 'name slug status isActive starRating averageRating totalBookings totalRevenue createdAt',
                options: { sort: { createdAt: -1 } }
            });

        if (!owner) {
            return res.status(404).json({ error: 'Owner not found' });
        }

        // Get additional statistics
        const hotels = owner.hotels;
        const totalHotels = hotels.length;
        const approvedHotels = hotels.filter(h => h.status === 'APPROVED').length;
        const pendingHotels = hotels.filter(h => h.status === 'PENDING').length;
        const rejectedHotels = hotels.filter(h => h.status === 'REJECTED').length;
        const suspendedHotels = hotels.filter(h => h.status === 'SUSPENDED').length;
        const activeHotels = hotels.filter(h => h.isActive === true).length;

        const totalRevenue = hotels.reduce((sum, h) => sum + (h.totalRevenue || 0), 0);
        const totalBookings = hotels.reduce((sum, h) => sum + (h.totalBookings || 0), 0);
        const averageRating = hotels.reduce((sum, h) => sum + (h.averageRating || 0), 0) / (totalHotels || 1);

        // Get recent bookings across all owner's hotels
        const hotelIds = hotels.map(h => h._id);
        const recentBookings = await Booking.find({ hotel: { $in: hotelIds } })
            .populate('user', 'Name email')
            .populate('hotel', 'name')
            .sort('-createdAt')
            .limit(10);

        // Get recent reviews
        const recentReviews = await Review.find({ hotel: { $in: hotelIds } })
            .populate('user', 'Name')
            .populate('hotel', 'name')
            .sort('-createdAt')
            .limit(10);

        const ownerStats = {
            totalHotels,
            approvedHotels,
            pendingHotels,
            rejectedHotels,
            suspendedHotels,
            activeHotels,
            totalRevenue,
            totalBookings,
            averageRating: averageRating.toFixed(2),
            completionRate: totalHotels > 0 ? ((approvedHotels / totalHotels) * 100).toFixed(1) : 0
        };

        res.json({
            owner: {
                _id: owner._id,
                Name: owner.Name,
                email: owner.email,
                phone: owner.phone,
                profileImage: owner.profileImage,
                businessInfo: owner.businessInfo,
                address: owner.address,
                isActive: owner.isActive,
                isVerified: owner.isVerified,
                createdAt: owner.createdAt,
                updatedAt: owner.updatedAt
            },
            statistics: ownerStats,
            hotels: owner.hotels,
            recentActivity: {
                recentBookings,
                recentReviews
            }
        });
    } catch (error) {
        console.error('Get single hotel owner error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE HOTEL OWNER STATUS ====================
router.patch('/admin/hotel-owners/:ownerId/status', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can update owner status
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { ownerId } = req.params;
        const { isActive, isVerified, isBlocked } = req.body;

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            return res.status(400).json({ error: 'Invalid owner ID' });
        }

        const owner = await User.findById(ownerId);

        if (!owner) {
            return res.status(404).json({ error: 'Owner not found' });
        }

        const updates = {};
        if (isActive !== undefined) updates.isActive = isActive;
        if (isVerified !== undefined) updates.isVerified = isVerified;
        if (isBlocked !== undefined) updates.isBlocked = isBlocked;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        // If blocking, also block all hotels
        if (isBlocked === true) {
            await Hotel.updateMany(
                { owner: ownerId },
                { $set: { isActive: false, status: 'SUSPENDED' } }
            );
            updates.refreshToken = undefined;
        } else if (isBlocked === false) {
            await Hotel.updateMany(
                { owner: ownerId, status: 'APPROVED' },
                { $set: { isActive: true } }
            );
        }

        // If deactivating, also deactivate all hotels
        if (isActive === false) {
            await Hotel.updateMany(
                { owner: ownerId },
                { $set: { isActive: false } }
            );
        } else if (isActive === true && isBlocked !== true) {
            await Hotel.updateMany(
                { owner: ownerId, status: 'APPROVED' },
                { $set: { isActive: true } }
            );
        }

        const updatedOwner = await User.findByIdAndUpdate(
            ownerId,
            { $set: updates },
            { new: true }
        ).select('-password -refreshToken -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry');

        res.json({
            message: 'Owner status updated successfully',
            owner: updatedOwner
        });
    } catch (error) {
        console.error('Update hotel owner status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET HOTEL OWNER PERFORMANCE ====================
router.get('/admin/hotel-owners/:ownerId/performance', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view owner performance
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { ownerId } = req.params;
        const { startDate, endDate } = req.query;

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            return res.status(400).json({ error: 'Invalid owner ID' });
        }

        const owner = await User.findById(ownerId).populate('hotels');

        if (!owner) {
            return res.status(404).json({ error: 'Owner not found' });
        }

        const hotelIds = owner.hotels.map(h => h._id);

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        const [
            totalBookings,
            completedBookings,
            cancelledBookings,
            totalRevenue,
            monthlyRevenue,
            monthlyBookings,
            averageRating,
            totalReviews,
            topPerformingHotel,
            worstPerformingHotel,
            bookingTrends
        ] = await Promise.all([
            Booking.countDocuments({ hotel: { $in: hotelIds } }),
            Booking.countDocuments({ hotel: { $in: hotelIds }, status: 'COMPLETED' }),
            Booking.countDocuments({ hotel: { $in: hotelIds }, status: 'CANCELLED' }),
            Booking.aggregate([
                { $match: { hotel: { $in: hotelIds }, status: 'COMPLETED', ...dateFilter } },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Booking.aggregate([
                { $match: { hotel: { $in: hotelIds }, status: 'COMPLETED', ...dateFilter } },
                {
                    $group: {
                        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                        revenue: { $sum: '$totalPrice' }
                    }
                },
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 6 }
            ]),
            Booking.aggregate([
                { $match: { hotel: { $in: hotelIds }, ...dateFilter } },
                {
                    $group: {
                        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 6 }
            ]),
            Review.aggregate([
                { $match: { hotel: { $in: hotelIds } } },
                { $group: { _id: null, avg: { $avg: '$rating' } } }
            ]),
            Review.countDocuments({ hotel: { $in: hotelIds } }),
            Hotel.findOne({ owner: ownerId, status: 'APPROVED' })
                .sort({ totalBookings: -1 })
                .select('name totalBookings totalRevenue averageRating'),
            Hotel.findOne({ owner: ownerId, status: 'APPROVED', totalBookings: { $gt: 0 } })
                .sort({ totalBookings: 1 })
                .select('name totalBookings totalRevenue averageRating'),
            Booking.aggregate([
                { $match: { hotel: { $in: hotelIds }, ...dateFilter } },
                {
                    $group: {
                        _id: { month: { $month: '$createdAt' }, week: { $week: '$createdAt' } },
                        bookings: { $sum: 1 },
                        revenue: { $sum: '$totalPrice' }
                    }
                },
                { $sort: { '_id.month': 1, '_id.week': 1 } }
            ])
        ]);

        const completionRate = totalBookings > 0 ? (completedBookings / totalBookings * 100).toFixed(1) : 0;
        const cancellationRate = totalBookings > 0 ? (cancelledBookings / totalBookings * 100).toFixed(1) : 0;

        res.json({
            owner: {
                _id: owner._id,
                Name: owner.Name,
                email: owner.email,
                businessInfo: owner.businessInfo
            },
            summary: {
                totalHotels: owner.hotels.length,
                totalBookings,
                completedBookings,
                cancelledBookings,
                completionRate: parseFloat(completionRate),
                cancellationRate: parseFloat(cancellationRate),
                totalRevenue: totalRevenue[0]?.total || 0,
                averageRating: averageRating[0]?.avg.toFixed(2) || 0,
                totalReviews
            },
            performance: {
                topPerformingHotel,
                worstPerformingHotel,
                monthlyRevenue,
                monthlyBookings,
                bookingTrends
            },
            period: {
                startDate: startDate || 'All time',
                endDate: endDate || 'Present'
            }
        });
    } catch (error) {
        console.error('Get hotel owner performance error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL HOTEL OWNERS STATISTICS ====================
router.get('/admin/hotel-owners/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view owner statistics
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const [
            totalOwners,
            activeOwners,
            inactiveOwners,
            blockedOwners,
            verifiedOwners,
            unverifiedOwners,
            ownersWithHotels,
            ownersByHotelCount,
            totalRevenueByOwners,
            topOwnersByRevenue,
            topOwnersByHotels,
            ownersGrowthTrend,
            averageHotelsPerOwner
        ] = await Promise.all([
            User.countDocuments({ hotels: { $exists: true, $ne: [] } }),
            User.countDocuments({ hotels: { $exists: true, $ne: [] }, isActive: true }),
            User.countDocuments({ hotels: { $exists: true, $ne: [] }, isActive: false }),
            User.countDocuments({ hotels: { $exists: true, $ne: [] }, isBlocked: true }),
            User.countDocuments({ hotels: { $exists: true, $ne: [] }, isVerified: true }),
            User.countDocuments({ hotels: { $exists: true, $ne: [] }, isVerified: false }),
            User.countDocuments({ hotels: { $exists: true, $ne: [] } }),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                { $project: { hotelCount: { $size: '$hotels' } } },
                {
                    $group: {
                        _id: '$hotelCount',
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                {
                    $lookup: {
                        from: 'hotels',
                        localField: 'hotels',
                        foreignField: '_id',
                        as: 'hotelDetails'
                    }
                },
                {
                    $addFields: {
                        totalRevenue: {
                            $sum: {
                                $map: {
                                    input: '$hotelDetails',
                                    as: 'hotel',
                                    in: { $ifNull: ['$$hotel.totalRevenue', 0] }
                                }
                            }
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$totalRevenue' },
                        avg: { $avg: '$totalRevenue' }
                    }
                }
            ]),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                {
                    $lookup: {
                        from: 'hotels',
                        localField: 'hotels',
                        foreignField: '_id',
                        as: 'hotelDetails'
                    }
                },
                {
                    $addFields: {
                        totalRevenue: {
                            $sum: {
                                $map: {
                                    input: '$hotelDetails',
                                    as: 'hotel',
                                    in: { $ifNull: ['$$hotel.totalRevenue', 0] }
                                }
                            }
                        },
                        totalBookings: {
                            $sum: {
                                $map: {
                                    input: '$hotelDetails',
                                    as: 'hotel',
                                    in: { $ifNull: ['$$hotel.totalBookings', 0] }
                                }
                            }
                        }
                    }
                },
                { $sort: { totalRevenue: -1 } },
                { $limit: 10 },
                { $project: { Name: 1, email: 1, totalRevenue: 1, totalBookings: 1, hotels: 1 } }
            ]),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                { $project: { Name: 1, email: 1, hotelCount: { $size: '$hotels' } } },
                { $sort: { hotelCount: -1 } },
                { $limit: 10 }
            ]),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                {
                    $group: {
                        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 12 }
            ]),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                { $group: { _id: null, avg: { $avg: { $size: '$hotels' } } } }
            ])
        ]);

        const activePercentage = totalOwners > 0 ? (activeOwners / totalOwners * 100).toFixed(1) : 0;
        const verifiedPercentage = totalOwners > 0 ? (verifiedOwners / totalOwners * 100).toFixed(1) : 0;

        res.json({
            overview: {
                totalOwners,
                activeOwners,
                inactiveOwners,
                blockedOwners,
                verifiedOwners,
                unverifiedOwners,
                activePercentage: parseFloat(activePercentage),
                verifiedPercentage: parseFloat(verifiedPercentage),
                averageHotelsPerOwner: averageHotelsPerOwner[0]?.avg.toFixed(2) || 0
            },
            distribution: {
                ownersByHotelCount,
                ownersGrowthTrend
            },
            financial: {
                totalRevenueGenerated: totalRevenueByOwners[0]?.total || 0,
                averageRevenuePerOwner: totalRevenueByOwners[0]?.avg.toFixed(2) || 0
            },
            leaders: {
                topOwnersByRevenue,
                topOwnersByHotels
            },
            generatedAt: new Date()
        });
    } catch (error) {
        console.error('Get hotel owners statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SUSPEND HOTEL OWNER ====================
router.post('/admin/hotel-owners/:ownerId/suspend', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can suspend owners
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { ownerId } = req.params;
        const { reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            return res.status(400).json({ error: 'Invalid owner ID' });
        }

        const owner = await User.findById(ownerId);

        if (!owner) {
            return res.status(404).json({ error: 'Owner not found' });
        }

        // Check for active bookings across all hotels
        const hotelIds = owner.hotels;
        const activeBookings = await Booking.countDocuments({
            hotel: { $in: hotelIds },
            status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({
                error: `Cannot suspend owner with ${activeBookings} active bookings across their hotels`
            });
        }

        owner.isActive = false;
        owner.isBlocked = true;
        owner.refreshToken = undefined;
        owner.suspensionReason = reason || 'Suspended by SUPER_ADMIN';
        await owner.save();

        // Suspend all hotels
        await Hotel.updateMany(
            { owner: ownerId },
            { $set: { isActive: false, status: 'SUSPENDED', suspensionReason: reason || 'Owner suspended' } }
        );

        // Suspend all rooms
        const rooms = await Room.find({ hotel: { $in: hotelIds } });
        for (const room of rooms) {
            room.isActive = false;
            room.status = 'INACTIVE';
            room.availableRooms = 0;
            await room.save();
        }

        res.json({
            message: 'Hotel owner suspended successfully',
            owner: {
                _id: owner._id,
                Name: owner.Name,
                email: owner.email,
                isActive: owner.isActive,
                isBlocked: owner.isBlocked,
                suspensionReason: owner.suspensionReason
            }
        });
    } catch (error) {
        console.error('Suspend hotel owner error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UNSUSPEND HOTEL OWNER ====================
router.post('/admin/hotel-owners/:ownerId/unsuspend', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can unsuspend owners
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { ownerId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            return res.status(400).json({ error: 'Invalid owner ID' });
        }

        const owner = await User.findById(ownerId);

        if (!owner) {
            return res.status(404).json({ error: 'Owner not found' });
        }

        owner.isActive = true;
        owner.isBlocked = false;
        owner.suspensionReason = undefined;
        await owner.save();

        // Unsuspend all approved hotels
        await Hotel.updateMany(
            { owner: ownerId, status: 'APPROVED' },
            { $set: { isActive: true, status: 'APPROVED', suspensionReason: undefined } }
        );

        // Unsuspend all rooms in approved hotels
        const hotels = await Hotel.find({ owner: ownerId, status: 'APPROVED' });
        const hotelIds = hotels.map(h => h._id);

        await Room.updateMany(
            { hotel: { $in: hotelIds } },
            { $set: { isActive: true, status: 'AVAILABLE' } }
        );

        res.json({
            message: 'Hotel owner unsuspended successfully',
            owner: {
                _id: owner._id,
                Name: owner.Name,
                email: owner.email,
                isActive: owner.isActive,
                isBlocked: owner.isBlocked
            }
        });
    } catch (error) {
        console.error('Unsuspend hotel owner error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});






module.exports = router;