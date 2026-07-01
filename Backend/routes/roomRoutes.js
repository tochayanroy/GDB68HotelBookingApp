const express = require('express');
const router = express.Router();
const passport = require('passport');
const mongoose = require('mongoose');

const Room = require('../models/RoomSchema.js');
const Hotel = require('../models/HotelSchema.js');
const Booking = require('../models/BookingSchema.js');
const { handleMulterError, uploadRoomThumbnail, uploadRoomGallery, uploadRoomThumbnailFlexible, uploadRoomGalleryFlexible, uploadRoomImages, uploadRoomImagesFlexible, } = require('../middleware/multer.js');




async function checkRoomAvailability(roomId, checkIn, checkOut, availableRooms) {
    const bookings = await Booking.find({
        room: roomId,
        status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
        $or: [
            { checkIn: { $lte: checkOut, $gte: checkIn } },
            { checkOut: { $lte: checkOut, $gte: checkIn } }
        ]
    });

    const bookedCount = bookings.reduce((sum, booking) => sum + booking.numberOfRooms, 0);
    return (availableRooms - bookedCount) > 0;
}

async function getBookedRoomsCount(roomId, checkIn, checkOut) {
    const bookings = await Booking.find({
        room: roomId,
        status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
        $or: [
            { checkIn: { $lte: checkOut, $gte: checkIn } },
            { checkOut: { $lte: checkOut, $gte: checkIn } }
        ]
    });

    return bookings.reduce((sum, booking) => sum + booking.numberOfRooms, 0);
}







////////////////////////// User //////////////////////////
////////////////////////// User //////////////////////////



// ==================== GET ALL ROOMS ====================
router.get('/rooms', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            sortBy = 'pricePerNight',
            sortOrder = 'asc',
            status = 'AVAILABLE',
            isActive = true
        } = req.query;

        const query = {
            status: status,
            isActive: isActive === 'true'
        };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [rooms, totalCount] = await Promise.all([
            Room.find(query)
                .populate('hotel', 'name slug starRating address thumbnail')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Room.countDocuments(query)
        ]);

        res.json({
            rooms,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalRooms: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get all rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE ROOM ====================
router.get('/rooms/:roomId', async (req, res) => {
    try {
        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findOne({
            _id: roomId,
            isActive: true
        }).populate('hotel', 'name slug starRating address contact policies');

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if hotel is active and approved
        const hotel = await Hotel.findById(room.hotel._id);
        if (!hotel.isActive || hotel.status !== 'APPROVED') {
            return res.status(403).json({ error: 'Hotel is not available' });
        }

        res.json(room);
    } catch (error) {
        console.error('Get single room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROOMS BY HOTEL ====================
router.get('/hotels/:hotelId/rooms', async (req, res) => {
    try {
        const { hotelId } = req.params;
        const {
            page = 1,
            limit = 10,
            status = 'AVAILABLE',
            sortBy = 'pricePerNight',
            sortOrder = 'asc'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        // Check if hotel exists and is active
        const hotel = await Hotel.findOne({
            _id: hotelId,
            isActive: true,
            status: 'APPROVED'
        });

        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or not available' });
        }

        const query = {
            hotel: hotelId,
            isActive: true
        };

        if (status !== 'all') {
            query.status = status;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [rooms, totalCount] = await Promise.all([
            Room.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Room.countDocuments(query)
        ]);

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name,
                slug: hotel.slug,
                starRating: hotel.starRating
            },
            rooms,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalRooms: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get rooms by hotel error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SEARCH ROOMS ====================
router.get('/rooms/search', async (req, res) => {
    try {
        const {
            q,
            hotelId,
            roomType,
            minPrice,
            maxPrice,
            minAdults,
            minChildren,
            checkIn,
            checkOut,
            page = 1,
            limit = 10,
            sortBy = 'pricePerNight',
            sortOrder = 'asc'
        } = req.query;

        const query = {
            isActive: true,
            status: 'AVAILABLE',
            availableRooms: { $gt: 0 }
        };

        // Text search by room name or description
        if (q) {
            query.$or = [
                { roomName: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } },
                { roomNumber: { $regex: q, $options: 'i' } }
            ];
        }

        // Filter by hotel
        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        // Filter by room type
        if (roomType && roomType !== 'all') {
            query.roomType = roomType;
        }

        // Filter by price range
        if (minPrice || maxPrice) {
            query.pricePerNight = {};
            if (minPrice) query.pricePerNight.$gte = parseInt(minPrice);
            if (maxPrice) query.pricePerNight.$lte = parseInt(maxPrice);
        }

        // Filter by capacity
        if (minAdults) {
            query.maxAdults = { $gte: parseInt(minAdults) };
        }
        if (minChildren) {
            query.maxChildren = { $gte: parseInt(minChildren) };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        let rooms = await Room.find(query)
            .populate('hotel', 'name slug starRating address thumbnail')
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit));

        // Check availability for dates if provided
        if (checkIn && checkOut) {
            const checkInDate = new Date(checkIn);
            const checkOutDate = new Date(checkOut);

            rooms = await Promise.all(rooms.map(async (room) => {
                const isAvailable = await checkRoomAvailability(
                    room._id,
                    checkInDate,
                    checkOutDate,
                    room.availableRooms
                );
                return {
                    ...room.toObject(),
                    isAvailableForDates: isAvailable
                };
            }));

            // Filter only available rooms
            rooms = rooms.filter(room => room.isAvailableForDates);
        }

        const totalCount = await Room.countDocuments(query);

        res.json({
            searchParams: {
                q: q || null,
                roomType: roomType || null,
                priceRange: { min: minPrice || null, max: maxPrice || null },
                dates: { checkIn: checkIn || null, checkOut: checkOut || null }
            },
            rooms,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalResults: rooms.length,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Search rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== FILTER ROOMS ====================
router.get('/rooms/filter', async (req, res) => {
    try {
        const {
            hotelId,
            roomType,
            bedType,
            amenities,
            minPrice,
            maxPrice,
            minSize,
            minRating,
            cancellationAllowed,
            refundable,
            minAdults,
            maxGuests,
            page = 1,
            limit = 10,
            sortBy = 'pricePerNight',
            sortOrder = 'asc'
        } = req.query;

        const query = {
            isActive: true,
            status: 'AVAILABLE',
            availableRooms: { $gt: 0 }
        };

        // Filter by hotel
        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        // Filter by room type
        if (roomType && roomType !== 'all') {
            query.roomType = roomType;
        }

        // Filter by bed type
        if (bedType) {
            query['beds.bedType'] = bedType;
        }

        // Filter by amenities
        if (amenities) {
            const amenitiesArray = amenities.split(',');
            query.amenities = { $all: amenitiesArray };
        }

        // Filter by price range
        if (minPrice || maxPrice) {
            query.pricePerNight = {};
            if (minPrice) query.pricePerNight.$gte = parseInt(minPrice);
            if (maxPrice) query.pricePerNight.$lte = parseInt(maxPrice);
        }

        // Filter by room size
        if (minSize) {
            query['roomSize.value'] = { $gte: parseInt(minSize) };
        }

        // Filter by rating
        if (minRating) {
            query.averageRating = { $gte: parseFloat(minRating) };
        }

        // Filter by cancellation policy
        if (cancellationAllowed !== undefined) {
            query.cancellationAllowed = cancellationAllowed === 'true';
        }

        // Filter by refundable status
        if (refundable !== undefined) {
            query.refundable = refundable === 'true';
        }

        // Filter by capacity
        if (minAdults) {
            query.maxAdults = { $gte: parseInt(minAdults) };
        }
        if (maxGuests) {
            query.maxGuests = { $lte: parseInt(maxGuests) };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [rooms, totalCount] = await Promise.all([
            Room.find(query)
                .populate('hotel', 'name slug starRating address')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Room.countDocuments(query)
        ]);

        // Get filter statistics for UI
        const filterStats = {
            priceRange: {
                min: await Room.findOne(query).sort('pricePerNight').select('pricePerNight'),
                max: await Room.findOne(query).sort('-pricePerNight').select('pricePerNight')
            },
            roomTypes: await Room.distinct('roomType', query),
            amenities: await Room.distinct('amenities', query),
            bedTypes: await Room.distinct('beds.bedType', query)
        };

        res.json({
            filters: {
                roomType,
                bedType,
                amenities: amenities ? amenities.split(',') : [],
                priceRange: { min: minPrice || null, max: maxPrice || null },
                minRating: minRating || null
            },
            filterStats,
            rooms,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalRooms: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Filter rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET AVAILABLE ROOMS ====================
router.get('/rooms/available', async (req, res) => {
    try {
        const {
            hotelId,
            checkIn,
            checkOut,
            adults = 1,
            children = 0,
            roomType,
            page = 1,
            limit = 10,
            sortBy = 'pricePerNight',
            sortOrder = 'asc'
        } = req.query;

        if (!checkIn || !checkOut) {
            return res.status(400).json({ error: 'Check-in and check-out dates are required' });
        }

        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);

        if (checkInDate >= checkOutDate) {
            return res.status(400).json({ error: 'Check-out date must be after check-in date' });
        }

        const query = {
            isActive: true,
            status: 'AVAILABLE',
            maxAdults: { $gte: parseInt(adults) },
            maxChildren: { $gte: parseInt(children) },
            maxGuests: { $gte: parseInt(adults) + parseInt(children) }
        };

        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        if (roomType && roomType !== 'all') {
            query.roomType = roomType;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        let rooms = await Room.find(query)
            .populate('hotel', 'name slug starRating address thumbnail')
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit));

        // Check availability for each room
        const roomsWithAvailability = await Promise.all(rooms.map(async (room) => {
            const bookedCount = await getBookedRoomsCount(
                room._id,
                checkInDate,
                checkOutDate
            );
            
            const availableCount = room.totalRooms - bookedCount;
            const isAvailable = availableCount > 0;

            return {
                ...room.toObject(),
                availableRoomsForDates: availableCount,
                isAvailableForDates: isAvailable,
                originalAvailableRooms: room.availableRooms
            };
        }));

        // Filter only available rooms
        const availableRooms = roomsWithAvailability.filter(room => room.isAvailableForDates);

        res.json({
            searchParams: {
                hotelId: hotelId || 'all',
                checkIn: checkInDate,
                checkOut: checkOutDate,
                guests: { adults: parseInt(adults), children: parseInt(children) }
            },
            rooms: availableRooms,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(availableRooms.length / parseInt(limit)),
                totalAvailable: availableRooms.length,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get available rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== CHECK ROOM AVAILABILITY ====================
router.get('/rooms/:roomId/availability', async (req, res) => {
    try {
        const { roomId } = req.params;
        const { checkIn, checkOut } = req.query;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        if (!checkIn || !checkOut) {
            return res.status(400).json({ error: 'Check-in and check-out dates are required' });
        }

        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);

        if (checkInDate >= checkOutDate) {
            return res.status(400).json({ error: 'Check-out date must be after check-in date' });
        }

        const room = await Room.findOne({
            _id: roomId,
            isActive: true
        }).populate('hotel', 'name slug starRating');

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Get all bookings for this room within the date range
        const bookings = await Booking.find({
            room: roomId,
            status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
            $or: [
                { checkIn: { $lte: checkOutDate, $gte: checkInDate } },
                { checkOut: { $lte: checkOutDate, $gte: checkInDate } }
            ]
        });

        const bookedCount = bookings.reduce((sum, booking) => sum + booking.numberOfRooms, 0);
        const availableCount = room.totalRooms - bookedCount;
        const isAvailable = availableCount > 0 && room.status === 'AVAILABLE' && room.isActive;

        // Get price breakdown
        const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
        const basePrice = room.pricePerNight * nights;
        const discountPrice = room.discountPrice ? room.discountPrice * nights : 0;
        const finalPrice = discountPrice > 0 ? discountPrice : basePrice;

        res.json({
            room: {
                id: room._id,
                roomName: room.roomName,
                roomType: room.roomType,
                roomNumber: room.roomNumber
            },
            hotel: room.hotel,
            availability: {
                isAvailable,
                availableRooms: availableCount,
                totalRooms: room.totalRooms,
                bookedRooms: bookedCount,
                status: room.status
            },
            pricing: {
                pricePerNight: room.pricePerNight,
                discountPrice: room.discountPrice || null,
                numberOfNights: nights,
                baseTotal: basePrice,
                discountedTotal: discountPrice > 0 ? finalPrice : null,
                finalPrice: finalPrice,
                currency: room.currency
            },
            cancellationPolicy: {
                cancellationAllowed: room.cancellationAllowed,
                cancellationHours: room.cancellationHours,
                refundable: room.refundable
            },
            checkIn: checkInDate,
            checkOut: checkOutDate
        });
    } catch (error) {
        console.error('Check room availability error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROOM DETAILS ====================
router.get('/rooms/:roomId/details', async (req, res) => {
    try {
        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findOne({
            _id: roomId,
            isActive: true
        })
            .populate('hotel', 'name slug description starRating address contact policies amenities averageRating totalReviews')
            .populate({
                path: 'hotel',
                populate: {
                    path: 'reviews',
                    select: 'rating comment createdAt',
                    options: { limit: 5 }
                }
            });

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Get similar rooms in the same hotel
        const similarRooms = await Room.find({
            hotel: room.hotel._id,
            _id: { $ne: roomId },
            isActive: true,
            status: 'AVAILABLE'
        })
            .limit(4)
            .select('roomName roomType pricePerNight thumbnail averageRating');

        // Get room statistics
        const totalBookings = await Booking.countDocuments({ room: roomId, status: 'COMPLETED' });
        const upcomingBookings = await Booking.countDocuments({
            room: roomId,
            checkIn: { $gte: new Date() },
            status: 'CONFIRMED'
        });

        // Get recent reviews for this room
        const recentReviews = await Booking.find({ room: roomId, reviewGiven: true })
            .populate('user', 'Name profileImage')
            .sort('-createdAt')
            .limit(5);

        res.json({
            room: {
                ...room.toObject(),
                statistics: {
                    totalBookings,
                    upcomingBookings,
                    averageRating: room.averageRating,
                    totalReviews: room.totalReviews
                }
            },
            similarRooms,
            recentReviews
        });
    } catch (error) {
        console.error('Get room details error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET TOP RATED ROOMS ====================
router.get('/rooms/top-rated', async (req, res) => {
    try {
        const {
            limit = 10,
            minReviews = 5,
            hotelId,
            minRating = 4
        } = req.query;

        const query = {
            isActive: true,
            status: 'AVAILABLE',
            averageRating: { $gte: parseFloat(minRating) },
            totalReviews: { $gte: parseInt(minReviews) }
        };

        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        const rooms = await Room.find(query)
            .populate('hotel', 'name slug starRating thumbnail address')
            .sort({ averageRating: -1, totalReviews: -1 })
            .limit(parseInt(limit));

        // Calculate weighted score for better ranking
        const roomsWithScore = rooms.map(room => {
            const weightedScore = (room.averageRating * 0.7) + (Math.min(room.totalReviews / 100, 1) * 0.3);
            return {
                ...room.toObject(),
                weightedScore: weightedScore.toFixed(2)
            };
        });

        // Sort by weighted score
        roomsWithScore.sort((a, b) => b.weightedScore - a.weightedScore);

        res.json({
            topRatedRooms: roomsWithScore,
            count: roomsWithScore.length,
            filters: {
                minRating: parseFloat(minRating),
                minReviews: parseInt(minReviews)
            }
        });
    } catch (error) {
        console.error('Get top rated rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

















////////////////////////// Admin //////////////////////////
////////////////////////// Admin //////////////////////////


// ==================== REMOVE ROOM AMENITIES ====================
router.delete('/rooms/:roomId/amenities', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;
        const { amenities } = req.body;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        if (!amenities || !Array.isArray(amenities) || amenities.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of amenities to remove' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        // Remove specified amenities
        const removedAmenities = [];
        const notFoundAmenities = [];

        amenities.forEach(amenity => {
            const index = room.amenities.indexOf(amenity);
            if (index !== -1) {
                room.amenities.splice(index, 1);
                removedAmenities.push(amenity);
            } else {
                notFoundAmenities.push(amenity);
            }
        });

        await room.save();

        res.json({
            message: `${removedAmenities.length} amenities removed successfully`,
            removedAmenities,
            notFoundAmenities: notFoundAmenities.length > 0 ? notFoundAmenities : undefined,
            remainingAmenities: room.amenities
        });
    } catch (error) {
        console.error('Remove room amenities error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== REMOVE SINGLE ROOM AMENITY ====================
router.delete('/rooms/:roomId/amenities/:amenity', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId, amenity } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        const decodedAmenity = decodeURIComponent(amenity);
        const index = room.amenities.indexOf(decodedAmenity);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Amenity not found in this room' });
        }

        room.amenities.splice(index, 1);
        await room.save();

        res.json({
            message: `Amenity "${decodedAmenity}" removed successfully`,
            removedAmenity: decodedAmenity,
            remainingAmenities: room.amenities
        });
    } catch (error) {
        console.error('Remove single room amenity error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK REMOVE ROOM AMENITIES ====================
router.post('/rooms/bulk-remove-amenities', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { updates } = req.body;

        if (!updates || !Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of updates with roomId and amenities' });
        }

        const results = [];
        const errors = [];

        for (const update of updates) {
            const { roomId, amenities } = update;

            if (!mongoose.Types.ObjectId.isValid(roomId)) {
                errors.push({ roomId, error: 'Invalid room ID' });
                continue;
            }

            if (!amenities || !Array.isArray(amenities) || amenities.length === 0) {
                errors.push({ roomId, error: 'Please provide amenities array to remove' });
                continue;
            }

            const room = await Room.findById(roomId).populate('hotel');
            
            if (!room) {
                errors.push({ roomId, error: 'Room not found' });
                continue;
            }

            // Check if user owns the hotel
            if (room.hotel.owner.toString() !== req.user._id.toString()) {
                errors.push({ roomId, error: 'You are not the owner of this room' });
                continue;
            }

            const removedAmenities = [];
            const notFoundAmenities = [];

            amenities.forEach(amenity => {
                const index = room.amenities.indexOf(amenity);
                if (index !== -1) {
                    room.amenities.splice(index, 1);
                    removedAmenities.push(amenity);
                } else {
                    notFoundAmenities.push(amenity);
                }
            });

            await room.save();

            results.push({
                roomId,
                roomName: room.roomName,
                removedAmenities,
                notFoundAmenities: notFoundAmenities.length > 0 ? notFoundAmenities : undefined,
                remainingAmenities: room.amenities
            });
        }

        res.json({
            message: `Processed ${results.length} rooms`,
            results,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Bulk remove room amenities error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// ==================== CREATE ROOM ====================
router.post('/hotels/:hotelId/rooms', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { hotelId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        // Check if hotel exists and user is the owner
        const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });
        
        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
        }

        // Check if hotel is approved
        if (hotel.status !== 'APPROVED') {
            return res.status(403).json({ error: 'Hotel must be approved before adding rooms' });
        }

        const {
            roomName,
            roomNumber,
            description,
            roomType,
            pricePerNight,
            discountPrice,
            currency,
            maxAdults,
            maxChildren,
            maxGuests,
            roomSize,
            beds,
            amenities,
            totalRooms,
            cancellationAllowed,
            cancellationHours,
            refundable
        } = req.body;

        // Check if room number already exists in this hotel
        const existingRoom = await Room.findOne({ hotel: hotelId, roomNumber });
        if (existingRoom) {
            return res.status(400).json({ error: 'Room number already exists in this hotel' });
        }

        const room = new Room({
            hotel: hotelId,
            roomName,
            roomNumber,
            description: description || '',
            roomType,
            pricePerNight,
            discountPrice: discountPrice || 0,
            currency: currency || 'INR',
            maxAdults: maxAdults || 1,
            maxChildren: maxChildren || 0,
            maxGuests: maxGuests || maxAdults || 1,
            roomSize: roomSize ? JSON.parse(roomSize) : {},
            beds: beds ? JSON.parse(beds) : [],
            amenities: amenities || [],
            totalRooms: totalRooms || 1,
            availableRooms: totalRooms || 1,
            cancellationAllowed: cancellationAllowed !== undefined ? cancellationAllowed : true,
            cancellationHours: cancellationHours || 24,
            refundable: refundable !== undefined ? refundable : true,
            status: 'AVAILABLE',
            isActive: true
        });

        await room.save();

        // Add room to hotel's rooms array
        hotel.rooms.push(room._id);
        await hotel.save();

        res.status(201).json({
            message: 'Room created successfully',
            room
        });
    } catch (error) {
        console.error('Create room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE ROOM ====================
router.put('/rooms/:roomId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        const {
            roomName,
            roomNumber,
            description,
            roomType,
            pricePerNight,
            discountPrice,
            currency,
            maxAdults,
            maxChildren,
            maxGuests,
            roomSize,
            beds,
            amenities,
            totalRooms,
            cancellationAllowed,
            cancellationHours,
            refundable
        } = req.body;

        // Check if room number already exists (excluding current room)
        if (roomNumber && roomNumber !== room.roomNumber) {
            const existingRoom = await Room.findOne({ 
                hotel: room.hotel._id, 
                roomNumber,
                _id: { $ne: roomId }
            });
            if (existingRoom) {
                return res.status(400).json({ error: 'Room number already exists in this hotel' });
            }
        }

        // Update fields
        if (roomName) room.roomName = roomName;
        if (roomNumber) room.roomNumber = roomNumber;
        if (description !== undefined) room.description = description;
        if (roomType) room.roomType = roomType;
        if (pricePerNight) room.pricePerNight = pricePerNight;
        if (discountPrice !== undefined) room.discountPrice = discountPrice;
        if (currency) room.currency = currency;
        if (maxAdults) room.maxAdults = maxAdults;
        if (maxChildren !== undefined) room.maxChildren = maxChildren;
        if (maxGuests) room.maxGuests = maxGuests;
        if (roomSize) room.roomSize = JSON.parse(roomSize);
        if (beds) room.beds = JSON.parse(beds);
        if (amenities) room.amenities = amenities;
        if (totalRooms) {
            const additionalRooms = totalRooms - room.totalRooms;
            room.totalRooms = totalRooms;
            room.availableRooms += additionalRooms;
        }
        if (cancellationAllowed !== undefined) room.cancellationAllowed = cancellationAllowed;
        if (cancellationHours) room.cancellationHours = cancellationHours;
        if (refundable !== undefined) room.refundable = refundable;

        await room.save();

        res.json({
            message: 'Room updated successfully',
            room
        });
    } catch (error) {
        console.error('Update room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE ROOM ====================
router.delete('/rooms/:roomId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        // Check for active bookings
        const activeBookings = await Booking.countDocuments({
            room: roomId,
            status: { $in: ['CONFIRMED', 'PENDING', 'CHECKED_IN'] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({ 
                error: `Cannot delete room with ${activeBookings} active bookings. Cancel them first.` 
            });
        }

        // Remove room from hotel's rooms array
        await Hotel.findByIdAndUpdate(room.hotel._id, {
            $pull: { rooms: roomId }
        });

        // Delete room images from filesystem
        if (room.thumbnail) {
            const thumbnailPath = path.join(__dirname, '..', room.thumbnail);
            if (fs.existsSync(thumbnailPath)) {
                fs.unlinkSync(thumbnailPath);
            }
        }

        room.images.forEach(image => {
            const imagePath = path.join(__dirname, '..', image);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        });

        // Delete the room
        await Room.findByIdAndDelete(roomId);

        res.json({ message: 'Room deleted successfully' });
    } catch (error) {
        console.error('Delete room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET MY HOTEL ROOMS ====================
router.get('/my-hotels/:hotelId/rooms', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { hotelId } = req.params;
        const {
            page = 1,
            limit = 10,
            status,
            roomType,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        // Check if user owns the hotel
        const hotel = await Hotel.findOne({ _id: hotelId, owner: req.user._id });
        
        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found or you are not the owner' });
        }

        const query = { hotel: hotelId };

        if (status && status !== 'all') {
            query.status = status;
        }

        if (roomType && roomType !== 'all') {
            query.roomType = roomType;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [rooms, totalCount] = await Promise.all([
            Room.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Room.countDocuments(query)
        ]);

        // Get statistics for each room
        const roomsWithStats = await Promise.all(rooms.map(async (room) => {
            const totalBookings = await Booking.countDocuments({ room: room._id });
            const activeBookings = await Booking.countDocuments({
                room: room._id,
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
            });
            
            return {
                ...room.toObject(),
                stats: {
                    totalBookings,
                    activeBookings,
                    occupancyRate: room.totalRooms > 0 ? ((room.totalRooms - room.availableRooms) / room.totalRooms * 100).toFixed(1) : 0
                }
            };
        }));

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name
            },
            rooms: roomsWithStats,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalRooms: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get my hotel rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET MY SINGLE ROOM ====================
router.get('/my-rooms/:roomId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        // Get room statistics
        const totalBookings = await Booking.countDocuments({ room: roomId });
        const completedBookings = await Booking.countDocuments({ room: roomId, status: 'COMPLETED' });
        const cancelledBookings = await Booking.countDocuments({ room: roomId, status: 'CANCELLED' });
        const upcomingBookings = await Booking.countDocuments({
            room: roomId,
            checkIn: { $gte: new Date() },
            status: 'CONFIRMED'
        });
        const totalRevenue = await Booking.aggregate([
            { $match: { room: new mongoose.Types.ObjectId(roomId), status: 'COMPLETED' } },
            { $group: { _id: null, total: { $sum: '$totalPrice' } } }
        ]);

        const roomWithStats = {
            ...room.toObject(),
            statistics: {
                totalBookings,
                completedBookings,
                cancelledBookings,
                upcomingBookings,
                totalRevenue: totalRevenue[0]?.total || 0,
                availableRooms: room.availableRooms,
                bookedRooms: room.totalRooms - room.availableRooms
            }
        };

        res.json(roomWithStats);
    } catch (error) {
        console.error('Get my single room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPLOAD ROOM THUMBNAIL ====================
router.post('/rooms/:roomId/thumbnail',
    passport.authenticate('jwt', { session: false }),
    uploadRoomThumbnail,
    async (req, res) => {
        try {
            const { roomId } = req.params;

            if (!mongoose.Types.ObjectId.isValid(roomId)) {
                return res.status(400).json({ error: 'Invalid room ID' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No thumbnail file provided' });
            }

            const room = await Room.findById(roomId).populate('hotel');
            
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            // Check if user owns the hotel
            if (room.hotel.owner.toString() !== req.user._id.toString()) {
                return res.status(403).json({ error: 'You are not the owner of this room' });
            }

            // Delete old thumbnail if exists
            if (room.thumbnail) {
                const oldThumbnailPath = path.join(__dirname, '..', room.thumbnail);
                if (fs.existsSync(oldThumbnailPath)) {
                    fs.unlinkSync(oldThumbnailPath);
                }
            }

            const thumbnailUrl = `/uploads/rooms/thumbnails/${req.file.filename}`;
            room.thumbnail = thumbnailUrl;
            await room.save();

            res.json({
                message: 'Room thumbnail uploaded successfully',
                thumbnail: thumbnailUrl
            });
        } catch (error) {
            console.error('Upload room thumbnail error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ==================== UPLOAD ROOM IMAGES ====================
router.post('/rooms/:roomId/images',
    passport.authenticate('jwt', { session: false }),
    uploadRoomImages,
    async (req, res) => {
        try {
            const { roomId } = req.params;

            if (!mongoose.Types.ObjectId.isValid(roomId)) {
                return res.status(400).json({ error: 'Invalid room ID' });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No image files provided' });
            }

            const room = await Room.findById(roomId).populate('hotel');
            
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            // Check if user owns the hotel
            if (room.hotel.owner.toString() !== req.user._id.toString()) {
                return res.status(403).json({ error: 'You are not the owner of this room' });
            }

            const imageUrls = req.files.map(file => `/uploads/rooms/images/${file.filename}`);
            room.images.push(...imageUrls);
            await room.save();

            res.json({
                message: `${imageUrls.length} images uploaded successfully`,
                images: room.images
            });
        } catch (error) {
            console.error('Upload room images error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ==================== DELETE ROOM IMAGE ====================
router.delete('/rooms/:roomId/images',
    passport.authenticate('jwt', { session: false }),
    async (req, res) => {
        try {
            const { roomId } = req.params;
            const { imageUrl } = req.body;

            if (!mongoose.Types.ObjectId.isValid(roomId)) {
                return res.status(400).json({ error: 'Invalid room ID' });
            }

            if (!imageUrl) {
                return res.status(400).json({ error: 'Image URL is required' });
            }

            const room = await Room.findById(roomId).populate('hotel');
            
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            // Check if user owns the hotel
            if (room.hotel.owner.toString() !== req.user._id.toString()) {
                return res.status(403).json({ error: 'You are not the owner of this room' });
            }

            // Remove from images array
            const imageIndex = room.images.indexOf(imageUrl);
            if (imageIndex === -1) {
                return res.status(404).json({ error: 'Image not found in room gallery' });
            }

            room.images.splice(imageIndex, 1);
            await room.save();

            // Delete file from filesystem
            const imagePath = path.join(__dirname, '..', imageUrl);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }

            res.json({
                message: 'Image deleted successfully',
                images: room.images
            });
        } catch (error) {
            console.error('Delete room image error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ==================== UPDATE ROOM AVAILABILITY ====================
router.patch('/rooms/:roomId/availability', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;
        const { availableRooms, operation } = req.body;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        if (operation) {
            // Increase or decrease availability
            if (operation === 'increase') {
                if (room.availableRooms < room.totalRooms) {
                    room.availableRooms++;
                } else {
                    return res.status(400).json({ error: 'Cannot increase beyond total rooms' });
                }
            } else if (operation === 'decrease') {
                if (room.availableRooms > 0) {
                    room.availableRooms--;
                } else {
                    return res.status(400).json({ error: 'Cannot decrease below 0' });
                }
            } else {
                return res.status(400).json({ error: 'Invalid operation. Use "increase" or "decrease"' });
            }
        } else if (availableRooms !== undefined) {
            // Set specific availability
            if (availableRooms < 0 || availableRooms > room.totalRooms) {
                return res.status(400).json({ error: `Available rooms must be between 0 and ${room.totalRooms}` });
            }
            room.availableRooms = availableRooms;
        } else {
            return res.status(400).json({ error: 'Please provide availableRooms or operation' });
        }

        // Update status based on availability
        if (room.availableRooms === 0) {
            room.status = 'FULLY_BOOKED';
        } else if (room.status === 'FULLY_BOOKED' && room.availableRooms > 0) {
            room.status = 'AVAILABLE';
        }

        await room.save();

        res.json({
            message: 'Room availability updated successfully',
            room: {
                id: room._id,
                roomName: room.roomName,
                totalRooms: room.totalRooms,
                availableRooms: room.availableRooms,
                status: room.status
            }
        });
    } catch (error) {
        console.error('Update room availability error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE ROOM STATUS ====================
router.patch('/rooms/:roomId/status', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;
        const { status, reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const validStatuses = ['AVAILABLE', 'FULLY_BOOKED', 'MAINTENANCE', 'INACTIVE'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        // Check for active bookings before setting maintenance or inactive
        if (status === 'MAINTENANCE' || status === 'INACTIVE') {
            const activeBookings = await Booking.countDocuments({
                room: roomId,
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
            });

            if (activeBookings > 0) {
                return res.status(400).json({ 
                    error: `Cannot set to ${status} with ${activeBookings} active bookings` 
                });
            }
        }

        room.status = status;
        
        if (status === 'MAINTENANCE' || status === 'INACTIVE') {
            room.isActive = false;
            room.availableRooms = 0;
        } else if (status === 'AVAILABLE') {
            room.isActive = true;
            if (room.availableRooms === 0 && room.totalRooms > 0) {
                room.availableRooms = room.totalRooms;
            }
        }

        await room.save();

        res.json({
            message: `Room status updated to ${status} successfully`,
            room: {
                id: room._id,
                roomName: room.roomName,
                status: room.status,
                isActive: room.isActive,
                availableRooms: room.availableRooms,
                reason: reason || null
            }
        });
    } catch (error) {
        console.error('Update room status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROOM STATISTICS ====================
router.get('/rooms/:roomId/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;
        const { startDate, endDate } = req.query;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        const [
            totalBookings,
            completedBookings,
            cancelledBookings,
            pendingBookings,
            totalRevenue,
            monthlyBookings,
            monthlyRevenue,
            occupancyHistory,
            averageRating,
            totalReviews
        ] = await Promise.all([
            Booking.countDocuments({ room: roomId }),
            Booking.countDocuments({ room: roomId, status: 'COMPLETED' }),
            Booking.countDocuments({ room: roomId, status: 'CANCELLED' }),
            Booking.countDocuments({ room: roomId, status: 'PENDING' }),
            Booking.aggregate([
                { $match: { room: new mongoose.Types.ObjectId(roomId), status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Booking.aggregate([
                { $match: { room: new mongoose.Types.ObjectId(roomId), ...dateFilter } },
                { $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    count: { $sum: 1 }
                }},
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 6 }
            ]),
            Booking.aggregate([
                { $match: { room: new mongoose.Types.ObjectId(roomId), status: 'COMPLETED', ...dateFilter } },
                { $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    revenue: { $sum: '$totalPrice' }
                }},
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 6 }
            ]),
            Booking.aggregate([
                { $match: { room: new mongoose.Types.ObjectId(roomId), status: 'COMPLETED' } },
                { $group: {
                    _id: { month: { $month: '$createdAt' } },
                    bookings: { $sum: 1 }
                }}
            ]),
            room.averageRating,
            room.totalReviews
        ]);

        const occupancyRate = room.totalRooms > 0 
            ? ((room.totalRooms - room.availableRooms) / room.totalRooms * 100).toFixed(1)
            : 0;

        res.json({
            room: {
                id: room._id,
                roomName: room.roomName,
                roomType: room.roomType,
                roomNumber: room.roomNumber
            },
            hotel: {
                id: room.hotel._id,
                name: room.hotel.name
            },
            bookingStats: {
                total: totalBookings,
                completed: completedBookings,
                cancelled: cancelledBookings,
                pending: pendingBookings,
                completionRate: totalBookings > 0 ? (completedBookings / totalBookings * 100).toFixed(1) : 0
            },
            revenueStats: {
                total: totalRevenue[0]?.total || 0,
                monthlyTrend: monthlyRevenue
            },
            occupancyStats: {
                totalRooms: room.totalRooms,
                availableRooms: room.availableRooms,
                bookedRooms: room.totalRooms - room.availableRooms,
                occupancyRate: parseFloat(occupancyRate),
                monthlyTrend: monthlyBookings,
                history: occupancyHistory
            },
            ratingStats: {
                average: averageRating,
                total: totalReviews
            },
            period: {
                startDate: startDate || 'All time',
                endDate: endDate || 'Present'
            }
        });
    } catch (error) {
        console.error('Get room statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROOM BOOKINGS ====================
router.get('/rooms/:roomId/bookings', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;
        const {
            page = 1,
            limit = 10,
            status,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        const query = { room: roomId };

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
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Booking.countDocuments(query)
        ]);

        // Calculate summary
        const summary = await Booking.aggregate([
            { $match: { room: new mongoose.Types.ObjectId(roomId) } },
            { $group: {
                _id: '$status',
                count: { $sum: 1 },
                revenue: { $sum: '$totalPrice' }
            }}
        ]);

        res.json({
            room: {
                id: room._id,
                roomName: room.roomName,
                roomNumber: room.roomNumber
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
        console.error('Get room bookings error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROOM REVIEWS ====================
router.get('/rooms/:roomId/reviews', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;
        const {
            page = 1,
            limit = 10,
            minRating,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        const query = { room: roomId };

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
            { $match: { room: new mongoose.Types.ObjectId(roomId) } },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        ratingDistribution.forEach(item => {
            distribution[item._id] = item.count;
        });

        res.json({
            room: {
                id: room._id,
                roomName: room.roomName,
                averageRating: room.averageRating,
                totalReviews: room.totalReviews
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
        console.error('Get room reviews error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADD ROOM AMENITIES ====================
router.post('/rooms/:roomId/amenities', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { roomId } = req.params;
        const { amenities } = req.body;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        if (!amenities || !Array.isArray(amenities) || amenities.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of amenities' });
        }

        const room = await Room.findById(roomId).populate('hotel');
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if user owns the hotel
        if (room.hotel.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'You are not the owner of this room' });
        }

        // Add unique amenities only
        const newAmenities = amenities.filter(a => !room.amenities.includes(a));
        room.amenities.push(...newAmenities);
        await room.save();

        res.json({
            message: `${newAmenities.length} amenities added successfully`,
            addedAmenities: newAmenities,
            allAmenities: room.amenities
        });
    } catch (error) {
        console.error('Add room amenities error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// ==================== GET ALL ROOMS (Admin) ====================
router.get('/admin/rooms', passport.authenticate('jwt', { session: false }), async (req, res) => {
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
            roomType,
            hotelId,
            isActive,
            minPrice,
            maxPrice,
            minRating,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        // Search by room name or number
        if (search) {
            query.$or = [
                { roomName: { $regex: search, $options: 'i' } },
                { roomNumber: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        // Filter by status
        if (status && status !== 'all') {
            query.status = status;
        }

        // Filter by room type
        if (roomType && roomType !== 'all') {
            query.roomType = roomType;
        }

        // Filter by hotel
        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        // Filter by active status
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        // Filter by price range
        if (minPrice || maxPrice) {
            query.pricePerNight = {};
            if (minPrice) query.pricePerNight.$gte = parseInt(minPrice);
            if (maxPrice) query.pricePerNight.$lte = parseInt(maxPrice);
        }

        // Filter by rating
        if (minRating) {
            query.averageRating = { $gte: parseFloat(minRating) };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [rooms, totalCount] = await Promise.all([
            Room.find(query)
                .populate('hotel', 'name slug owner starRating address')
                .populate({
                    path: 'hotel',
                    populate: {
                        path: 'owner',
                        select: 'Name email phone'
                    }
                })
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Room.countDocuments(query)
        ]);

        // Get additional stats for each room
        const roomsWithStats = await Promise.all(rooms.map(async (room) => {
            const totalBookings = await Booking.countDocuments({ room: room._id });
            const activeBookings = await Booking.countDocuments({
                room: room._id,
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
            });
            
            return {
                ...room.toObject(),
                stats: {
                    totalBookings,
                    activeBookings,
                    occupancyRate: room.totalRooms > 0 
                        ? ((room.totalRooms - room.availableRooms) / room.totalRooms * 100).toFixed(1)
                        : 0
                }
            };
        }));

        res.json({
            rooms: roomsWithStats,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalRooms: totalCount,
                limit: parseInt(limit)
            },
            filters: {
                status: status || 'all',
                roomType: roomType || 'all',
                isActive: isActive !== undefined ? isActive === 'true' : null
            }
        });
    } catch (error) {
        console.error('Get all rooms admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SINGLE ROOM (Admin) ====================
router.get('/admin/rooms/:roomId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Check if user is SUPER_ADMIN or ADMIN
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId)
            .populate('hotel', 'name slug owner starRating address contact policies')
            .populate({
                path: 'hotel',
                populate: {
                    path: 'owner',
                    select: 'Name email phone businessInfo'
                }
            });

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Get detailed statistics
        const [
            totalBookings,
            completedBookings,
            cancelledBookings,
            pendingBookings,
            totalRevenue,
            upcomingBookings,
            recentBookings,
            reviews
        ] = await Promise.all([
            Booking.countDocuments({ room: roomId }),
            Booking.countDocuments({ room: roomId, status: 'COMPLETED' }),
            Booking.countDocuments({ room: roomId, status: 'CANCELLED' }),
            Booking.countDocuments({ room: roomId, status: 'PENDING' }),
            Booking.aggregate([
                { $match: { room: new mongoose.Types.ObjectId(roomId), status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Booking.countDocuments({
                room: roomId,
                checkIn: { $gte: new Date() },
                status: 'CONFIRMED'
            }),
            Booking.find({ room: roomId })
                .populate('user', 'Name email phone')
                .sort('-createdAt')
                .limit(5),
            Review.find({ room: roomId })
                .populate('user', 'Name profileImage')
                .sort('-createdAt')
                .limit(5)
        ]);

        const roomWithStats = {
            ...room.toObject(),
            adminStats: {
                totalBookings,
                completedBookings,
                cancelledBookings,
                pendingBookings,
                upcomingBookings,
                totalRevenue: totalRevenue[0]?.total || 0,
                recentBookings,
                recentReviews: reviews
            }
        };

        res.json(roomWithStats);
    } catch (error) {
        console.error('Get single room admin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE ANY ROOM ====================
router.put('/admin/rooms/:roomId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can update any room
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        const {
            roomName,
            roomNumber,
            description,
            roomType,
            pricePerNight,
            discountPrice,
            currency,
            maxAdults,
            maxChildren,
            maxGuests,
            roomSize,
            beds,
            amenities,
            totalRooms,
            availableRooms,
            cancellationAllowed,
            cancellationHours,
            refundable,
            status,
            isActive
        } = req.body;

        // Update fields
        if (roomName) room.roomName = roomName;
        if (roomNumber) room.roomNumber = roomNumber;
        if (description !== undefined) room.description = description;
        if (roomType) room.roomType = roomType;
        if (pricePerNight) room.pricePerNight = pricePerNight;
        if (discountPrice !== undefined) room.discountPrice = discountPrice;
        if (currency) room.currency = currency;
        if (maxAdults) room.maxAdults = maxAdults;
        if (maxChildren !== undefined) room.maxChildren = maxChildren;
        if (maxGuests) room.maxGuests = maxGuests;
        if (roomSize) room.roomSize = roomSize;
        if (beds) room.beds = beds;
        if (amenities) room.amenities = amenities;
        if (totalRooms) room.totalRooms = totalRooms;
        if (availableRooms !== undefined) room.availableRooms = availableRooms;
        if (cancellationAllowed !== undefined) room.cancellationAllowed = cancellationAllowed;
        if (cancellationHours) room.cancellationHours = cancellationHours;
        if (refundable !== undefined) room.refundable = refundable;
        if (status) room.status = status;
        if (isActive !== undefined) room.isActive = isActive;

        await room.save();

        res.json({
            message: 'Room updated successfully by admin',
            room
        });
    } catch (error) {
        console.error('Update any room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE ANY ROOM ====================
router.delete('/admin/rooms/:roomId', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can delete any room
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check for active bookings
        const activeBookings = await Booking.countDocuments({
            room: roomId,
            status: { $in: ['CONFIRMED', 'PENDING', 'CHECKED_IN'] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({ 
                error: `Cannot delete room with ${activeBookings} active bookings` 
            });
        }

        // Remove room from hotel's rooms array
        await Hotel.findByIdAndUpdate(room.hotel, {
            $pull: { rooms: roomId }
        });

        // Delete all associated bookings and reviews
        await Booking.deleteMany({ room: roomId });
        await Review.deleteMany({ room: roomId });

        // Delete the room
        await Room.findByIdAndDelete(roomId);

        res.json({
            message: 'Room permanently deleted successfully',
            deletedRoom: {
                id: room._id,
                roomName: room.roomName,
                hotel: room.hotel
            }
        });
    } catch (error) {
        console.error('Delete any room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ACTIVATE ROOM ====================
router.patch('/admin/rooms/:roomId/activate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can activate rooms
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        room.isActive = true;
        if (room.status === 'INACTIVE') {
            room.status = 'AVAILABLE';
        }
        await room.save();

        res.json({
            message: 'Room activated successfully',
            room: {
                id: room._id,
                roomName: room.roomName,
                isActive: room.isActive,
                status: room.status
            }
        });
    } catch (error) {
        console.error('Activate room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DEACTIVATE ROOM ====================
router.patch('/admin/rooms/:roomId/deactivate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can deactivate rooms
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check for active bookings
        const activeBookings = await Booking.countDocuments({
            room: roomId,
            status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({ 
                error: `Cannot deactivate room with ${activeBookings} active bookings` 
            });
        }

        room.isActive = false;
        room.status = 'INACTIVE';
        room.availableRooms = 0;
        await room.save();

        res.json({
            message: 'Room deactivated successfully',
            room: {
                id: room._id,
                roomName: room.roomName,
                isActive: room.isActive,
                status: room.status
            }
        });
    } catch (error) {
        console.error('Deactivate room error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SET ROOM MAINTENANCE ====================
router.patch('/admin/rooms/:roomId/maintenance', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can set maintenance
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomId } = req.params;
        const { reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check for active bookings
        const activeBookings = await Booking.countDocuments({
            room: roomId,
            status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
        });

        if (activeBookings > 0) {
            return res.status(400).json({ 
                error: `Cannot set maintenance with ${activeBookings} active bookings` 
            });
        }

        room.status = 'MAINTENANCE';
        room.isActive = false;
        room.availableRooms = 0;
        room.maintenanceReason = reason || 'Under maintenance';
        await room.save();

        res.json({
            message: 'Room set to maintenance mode',
            room: {
                id: room._id,
                roomName: room.roomName,
                status: room.status,
                maintenanceReason: room.maintenanceReason
            }
        });
    } catch (error) {
        console.error('Set room maintenance error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== REMOVE ROOM MAINTENANCE ====================
router.patch('/admin/rooms/:roomId/remove-maintenance', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can remove maintenance
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        room.status = 'AVAILABLE';
        room.isActive = true;
        room.availableRooms = room.totalRooms;
        room.maintenanceReason = undefined;
        await room.save();

        res.json({
            message: 'Maintenance mode removed',
            room: {
                id: room._id,
                roomName: room.roomName,
                status: room.status,
                isActive: room.isActive
            }
        });
    } catch (error) {
        console.error('Remove room maintenance error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MARK ROOM AVAILABLE ====================
router.patch('/admin/rooms/:roomId/mark-available', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can mark rooms available
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        room.status = 'AVAILABLE';
        room.isActive = true;
        if (room.availableRooms === 0) {
            room.availableRooms = room.totalRooms;
        }
        await room.save();

        res.json({
            message: 'Room marked as available',
            room: {
                id: room._id,
                roomName: room.roomName,
                status: room.status,
                availableRooms: room.availableRooms
            }
        });
    } catch (error) {
        console.error('Mark room available error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MARK ROOM FULLY BOOKED ====================
router.patch('/admin/rooms/:roomId/mark-fully-booked', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can mark rooms fully booked
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(roomId)) {
            return res.status(400).json({ error: 'Invalid room ID' });
        }

        const room = await Room.findById(roomId);
        
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        room.status = 'FULLY_BOOKED';
        room.availableRooms = 0;
        await room.save();

        res.json({
            message: 'Room marked as fully booked',
            room: {
                id: room._id,
                roomName: room.roomName,
                status: room.status,
                availableRooms: room.availableRooms
            }
        });
    } catch (error) {
        console.error('Mark room fully booked error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET INACTIVE ROOMS ====================
router.get('/admin/rooms/inactive', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view inactive rooms
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            hotelId,
            sortBy = 'updatedAt',
            sortOrder = 'desc'
        } = req.query;

        const query = { isActive: false };

        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [rooms, totalCount] = await Promise.all([
            Room.find(query)
                .populate('hotel', 'name slug owner')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Room.countDocuments(query)
        ]);

        res.json({
            inactiveRooms: rooms,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalInactive: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get inactive rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET MAINTENANCE ROOMS ====================
router.get('/admin/rooms/maintenance', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view maintenance rooms
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            page = 1,
            limit = 10,
            hotelId,
            sortBy = 'updatedAt',
            sortOrder = 'desc'
        } = req.query;

        const query = { status: 'MAINTENANCE' };

        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
            query.hotel = hotelId;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [rooms, totalCount] = await Promise.all([
            Room.find(query)
                .populate('hotel', 'name slug owner')
                .select('roomName roomNumber hotel status maintenanceReason updatedAt')
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Room.countDocuments(query)
        ]);

        res.json({
            maintenanceRooms: rooms,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalMaintenance: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get maintenance rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROOM ANALYTICS ====================
router.get('/admin/rooms/analytics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view room analytics
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            startDate,
            endDate,
            groupBy = 'month'
        } = req.query;

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

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
                dateGroupFormat = { $month: '$createdAt' };
        }

        const [
            totalRooms,
            roomsByStatus,
            roomsByType,
            roomsByHotel,
            averagePriceByType,
            occupancyTrends,
            revenueByRoomType,
            topPerformingRooms,
            worstPerformingRooms,
            roomsWithNoBookings,
            averageOccupancyRate
        ] = await Promise.all([
            Room.countDocuments(),
            Room.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Room.aggregate([
                { $group: { _id: '$roomType', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            Room.aggregate([
                { $group: { _id: '$hotel', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                { $lookup: {
                    from: 'hotels',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'hotel'
                }},
                { $unwind: '$hotel' }
            ]),
            Room.aggregate([
                { $group: {
                    _id: '$roomType',
                    avgPrice: { $avg: '$pricePerNight' },
                    minPrice: { $min: '$pricePerNight' },
                    maxPrice: { $max: '$pricePerNight' }
                }}
            ]),
            Booking.aggregate([
                { $match: dateFilter },
                { $group: {
                    _id: dateGroupFormat,
                    bookings: { $sum: 1 },
                    roomsBooked: { $sum: '$numberOfRooms' }
                }},
                { $sort: { _id: 1 } }
            ]),
            Booking.aggregate([
                { $match: { status: 'COMPLETED', ...dateFilter } },
                { $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'room'
                }},
                { $unwind: '$room' },
                { $group: {
                    _id: '$room.roomType',
                    revenue: { $sum: '$totalPrice' },
                    bookings: { $sum: 1 }
                }},
                { $sort: { revenue: -1 } }
            ]),
            Room.aggregate([
                { $lookup: {
                    from: 'bookings',
                    localField: '_id',
                    foreignField: 'room',
                    as: 'bookings'
                }},
                { $addFields: { bookingCount: { $size: '$bookings' } } },
                { $sort: { bookingCount: -1 } },
                { $limit: 10 },
                { $project: { roomName: 1, roomType: 1, bookingCount: 1, totalRevenue: { $sum: '$bookings.totalPrice' } } }
            ]),
            Room.aggregate([
                { $lookup: {
                    from: 'bookings',
                    localField: '_id',
                    foreignField: 'room',
                    as: 'bookings'
                }},
                { $addFields: { bookingCount: { $size: '$bookings' } } },
                { $match: { bookingCount: 0 } },
                { $limit: 10 },
                { $project: { roomName: 1, roomType: 1, hotel: 1, pricePerNight: 1 } }
            ]),
            Room.aggregate([
                { $group: {
                    _id: null,
                    avgOccupancy: { $avg: { 
                        $multiply: [
                            { $divide: ['$totalBookings', { $ifNull: ['$totalRooms', 1] }] },
                            100
                        ]
                    } }
                }}
            ])
        ]);

        res.json({
            overview: {
                totalRooms,
                averageOccupancyRate: averageOccupancyRate[0]?.avgOccupancy.toFixed(2) || 0,
                roomsByStatus,
                roomsByType
            },
            pricing: {
                averagePriceByType
            },
            performance: {
                occupancyTrends,
                revenueByRoomType,
                topPerformingRooms,
                worstPerformingRooms,
                roomsWithNoBookings: roomsWithNoBookings.length
            },
            distribution: {
                roomsByHotel: roomsByHotel.map(item => ({
                    hotelName: item.hotel.name,
                    roomCount: item.count
                }))
            },
            filters: {
                startDate: startDate || null,
                endDate: endDate || null,
                groupBy
            }
        });
    } catch (error) {
        console.error('Get room analytics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ROOM STATISTICS (Global) ====================
router.get('/admin/rooms/statistics', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view global room statistics
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const [
            totalRooms,
            availableRooms,
            fullyBookedRooms,
            maintenanceRooms,
            inactiveRooms,
            totalRoomTypes,
            totalCapacity,
            averagePrice,
            totalBookingsAllTime,
            totalRevenueAllTime,
            roomsAddedThisMonth,
            roomsAddedThisYear,
            mostPopularRoomType,
            highestRatedRooms,
            mostBookedRooms
        ] = await Promise.all([
            Room.countDocuments(),
            Room.countDocuments({ status: 'AVAILABLE', isActive: true }),
            Room.countDocuments({ status: 'FULLY_BOOKED' }),
            Room.countDocuments({ status: 'MAINTENANCE' }),
            Room.countDocuments({ status: 'INACTIVE' }),
            Room.distinct('roomType'),
            Room.aggregate([
                { $group: { _id: null, total: { $sum: '$maxGuests' } } }
            ]),
            Room.aggregate([
                { $group: { _id: null, avg: { $avg: '$pricePerNight' } } }
            ]),
            Booking.countDocuments(),
            Booking.aggregate([
                { $match: { status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: '$totalPrice' } } }
            ]),
            Room.countDocuments({
                createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
            }),
            Room.countDocuments({
                createdAt: { $gte: new Date(new Date().getFullYear(), 0, 1) }
            }),
            Room.aggregate([
                { $group: { _id: '$roomType', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]),
            Room.find({ averageRating: { $gt: 0 } })
                .sort({ averageRating: -1 })
                .limit(5)
                .select('roomName roomType averageRating totalReviews hotel'),
            Room.aggregate([
                { $lookup: {
                    from: 'bookings',
                    localField: '_id',
                    foreignField: 'room',
                    as: 'bookings'
                }},
                { $addFields: { bookingCount: { $size: '$bookings' } } },
                { $sort: { bookingCount: -1 } },
                { $limit: 5 },
                { $project: { roomName: 1, roomType: 1, bookingCount: 1 } }
            ])
        ]);

        // Calculate utilization rate
        const utilizationRate = totalRooms > 0 
            ? ((totalRooms - (maintenanceRooms + inactiveRooms)) / totalRooms * 100).toFixed(1)
            : 0;

        res.json({
            systemOverview: {
                totalRooms,
                availableRooms,
                fullyBookedRooms,
                maintenanceRooms,
                inactiveRooms,
                utilizationRate: parseFloat(utilizationRate),
                totalRoomTypes: totalRoomTypes.length,
                totalGuestCapacity: totalCapacity[0]?.total || 0,
                averagePricePerNight: averagePrice[0]?.avg.toFixed(2) || 0,
                totalBookings: totalBookingsAllTime,
                totalRevenue: totalRevenueAllTime[0]?.total || 0
            },
            growth: {
                roomsAddedThisMonth,
                roomsAddedThisYear
            },
            topPerformers: {
                mostPopularRoomType: mostPopularRoomType[0]?._id || 'N/A',
                highestRatedRooms,
                mostBookedRooms
            },
            generatedAt: new Date()
        });
    } catch (error) {
        console.error('Get room statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK ACTIVATE ROOMS ====================
router.post('/admin/rooms/bulk-activate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can bulk activate
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomIds } = req.body;

        if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of room IDs' });
        }

        const validIds = roomIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        const result = await Room.updateMany(
            { _id: { $in: validIds } },
            { 
                $set: { 
                    isActive: true,
                    status: 'AVAILABLE'
                } 
            }
        );

        res.json({
            message: `Successfully activated ${result.modifiedCount} rooms`,
            statistics: {
                requested: roomIds.length,
                activated: result.modifiedCount,
                failed: roomIds.length - result.modifiedCount
            }
        });
    } catch (error) {
        console.error('Bulk activate rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK DEACTIVATE ROOMS ====================
router.post('/admin/rooms/bulk-deactivate', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can bulk deactivate
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomIds } = req.body;

        if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of room IDs' });
        }

        const validIds = roomIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        // Check for active bookings before deactivation
        const roomsWithBookings = [];
        for (const roomId of validIds) {
            const activeBookings = await Booking.countDocuments({
                room: roomId,
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
            });
            if (activeBookings > 0) {
                const room = await Room.findById(roomId).select('roomName roomNumber');
                roomsWithBookings.push({ 
                    roomId, 
                    roomName: room?.roomName,
                    activeBookings 
                });
            }
        }

        if (roomsWithBookings.length > 0) {
            return res.status(400).json({
                error: 'Some rooms have active bookings',
                roomsWithActiveBookings: roomsWithBookings
            });
        }

        const result = await Room.updateMany(
            { _id: { $in: validIds } },
            { 
                $set: { 
                    isActive: false,
                    status: 'INACTIVE',
                    availableRooms: 0
                } 
            }
        );

        res.json({
            message: `Successfully deactivated ${result.modifiedCount} rooms`,
            statistics: {
                requested: roomIds.length,
                deactivated: result.modifiedCount,
                failed: roomIds.length - result.modifiedCount
            }
        });
    } catch (error) {
        console.error('Bulk deactivate rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK DELETE ROOMS ====================
router.post('/admin/rooms/bulk-delete', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can bulk delete rooms
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const { roomIds, permanent = false } = req.body;

        if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of room IDs' });
        }

        const validIds = roomIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        // Check for active bookings
        const roomsWithBookings = [];
        for (const roomId of validIds) {
            const activeBookings = await Booking.countDocuments({
                room: roomId,
                status: { $in: ['CONFIRMED', 'PENDING', 'CHECKED_IN'] }
            });
            if (activeBookings > 0) {
                const room = await Room.findById(roomId).select('roomName roomNumber');
                roomsWithBookings.push({ 
                    roomId, 
                    roomName: room?.roomName,
                    activeBookings 
                });
            }
        }

        if (roomsWithBookings.length > 0) {
            return res.status(400).json({
                error: 'Some rooms have active bookings',
                roomsWithActiveBookings: roomsWithBookings
            });
        }

        let deletedCount = 0;
        const failedDeletions = [];

        if (permanent) {
            // Permanent deletion
            for (const roomId of validIds) {
                try {
                    const room = await Room.findById(roomId);
                    if (room) {
                        // Remove room from hotel's rooms array
                        await Hotel.findByIdAndUpdate(room.hotel, {
                            $pull: { rooms: roomId }
                        });
                        
                        // Delete associated data
                        await Booking.deleteMany({ room: roomId });
                        await Review.deleteMany({ room: roomId });
                        await Room.findByIdAndDelete(roomId);
                        
                        deletedCount++;
                    }
                } catch (error) {
                    failedDeletions.push({ roomId, error: error.message });
                }
            }
        } else {
            // Soft delete - deactivate
            const result = await Room.updateMany(
                { _id: { $in: validIds } },
                { 
                    $set: { 
                        isActive: false,
                        status: 'INACTIVE',
                        availableRooms: 0
                    } 
                }
            );
            deletedCount = result.modifiedCount;
        }

        res.json({
            message: permanent ? `Successfully deleted ${deletedCount} rooms permanently` : `Successfully deactivated ${deletedCount} rooms`,
            statistics: {
                requested: roomIds.length,
                processed: deletedCount,
                failed: failedDeletions.length
            },
            failedDeletions: failedDeletions.length > 0 ? failedDeletions : undefined
        });
    } catch (error) {
        console.error('Bulk delete rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== BULK UPDATE ROOM STATUS ====================
router.post('/admin/rooms/bulk-update-status', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can bulk update status
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomIds, status } = req.body;

        if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of room IDs' });
        }

        const validStatuses = ['AVAILABLE', 'FULLY_BOOKED', 'MAINTENANCE', 'INACTIVE'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const validIds = roomIds.filter(id => mongoose.Types.ObjectId.isValid(id));

        // Check for active bookings when setting maintenance or inactive
        if (status === 'MAINTENANCE' || status === 'INACTIVE') {
            const roomsWithBookings = [];
            for (const roomId of validIds) {
                const activeBookings = await Booking.countDocuments({
                    room: roomId,
                    status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
                });
                if (activeBookings > 0) {
                    const room = await Room.findById(roomId).select('roomName');
                    roomsWithBookings.push({ 
                        roomId, 
                        roomName: room?.roomName,
                        activeBookings 
                    });
                }
            }

            if (roomsWithBookings.length > 0) {
                return res.status(400).json({
                    error: 'Some rooms have active bookings',
                    roomsWithActiveBookings: roomsWithBookings
                });
            }
        }

        const updateData = { status };
        
        if (status === 'AVAILABLE') {
            updateData.isActive = true;
        } else if (status === 'FULLY_BOOKED') {
            updateData.availableRooms = 0;
        } else if (status === 'MAINTENANCE' || status === 'INACTIVE') {
            updateData.isActive = false;
            updateData.availableRooms = 0;
        }

        const result = await Room.updateMany(
            { _id: { $in: validIds } },
            { $set: updateData }
        );

        res.json({
            message: `Successfully updated status to ${status} for ${result.modifiedCount} rooms`,
            statistics: {
                requested: roomIds.length,
                updated: result.modifiedCount,
                failed: roomIds.length - result.modifiedCount
            }
        });
    } catch (error) {
        console.error('Bulk update room status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET ALL ROOM ANALYTICS ====================
router.get('/admin/rooms/analytics/all', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view analytics
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            startDate,
            endDate,
            hotelId,
            roomType,
            groupBy = 'month'
        } = req.query;

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        const roomFilter = {};
        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) roomFilter.hotel = hotelId;
        if (roomType && roomType !== 'all') roomFilter.roomType = roomType;

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
                dateGroupFormat = { $month: '$createdAt' };
        }

        const [
            totalRooms,
            roomsByStatus,
            roomsByType,
            occupancyTrend,
            revenueTrend,
            bookingTrend,
            averageDailyRate,
            revenuePerAvailableRoom,
            topRoomsByRevenue,
            topRoomsByBookings,
            roomsByPriceRange,
            capacityUtilization,
            seasonalTrends
        ] = await Promise.all([
            Room.countDocuments(roomFilter),
            Room.aggregate([
                { $match: roomFilter },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Room.aggregate([
                { $match: roomFilter },
                { $group: { _id: '$roomType', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            Booking.aggregate([
                { $match: { ...dateFilter } },
                { $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'roomDetails'
                }},
                { $unwind: '$roomDetails' },
                { $match: roomFilter },
                { $group: {
                    _id: dateGroupFormat,
                    occupancyRate: {
                        $avg: {
                            $multiply: [
                                { $divide: ['$numberOfRooms', { $ifNull: ['$roomDetails.totalRooms', 1] }] },
                                100
                            ]
                        }
                    },
                    totalRoomsBooked: { $sum: '$numberOfRooms' }
                }},
                { $sort: { _id: 1 } }
            ]),
            Booking.aggregate([
                { $match: { status: 'COMPLETED', ...dateFilter } },
                { $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'roomDetails'
                }},
                { $unwind: '$roomDetails' },
                { $match: roomFilter },
                { $group: {
                    _id: dateGroupFormat,
                    revenue: { $sum: '$totalPrice' }
                }},
                { $sort: { _id: 1 } }
            ]),
            Booking.aggregate([
                { $match: { ...dateFilter } },
                { $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'roomDetails'
                }},
                { $unwind: '$roomDetails' },
                { $match: roomFilter },
                { $group: {
                    _id: dateGroupFormat,
                    bookings: { $sum: 1 }
                }},
                { $sort: { _id: 1 } }
            ]),
            Booking.aggregate([
                { $match: { status: 'COMPLETED', ...dateFilter } },
                { $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'roomDetails'
                }},
                { $unwind: '$roomDetails' },
                { $match: roomFilter },
                { $group: {
                    _id: null,
                    avgDailyRate: { $avg: '$roomDetails.pricePerNight' }
                }}
            ]),
            Booking.aggregate([
                { $match: { status: 'COMPLETED', ...dateFilter } },
                { $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'roomDetails'
                }},
                { $unwind: '$roomDetails' },
                { $match: roomFilter },
                { $group: {
                    _id: null,
                    revPAR: {
                        $avg: {
                            $multiply: [
                                '$roomDetails.pricePerNight',
                                { $divide: ['$numberOfRooms', { $ifNull: ['$roomDetails.totalRooms', 1] }] }
                            ]
                        }
                    }
                }}
            ]),
            Room.aggregate([
                { $match: roomFilter },
                { $lookup: {
                    from: 'bookings',
                    localField: '_id',
                    foreignField: 'room',
                    as: 'bookings'
                }},
                { $addFields: {
                    totalRevenue: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: '$bookings',
                                        cond: { $eq: ['$$this.status', 'COMPLETED'] }
                                    }
                                },
                                as: 'booking',
                                in: '$$booking.totalPrice'
                            }
                        }
                    },
                    bookingCount: { $size: '$bookings' }
                }},
                { $sort: { totalRevenue: -1 } },
                { $limit: 10 },
                { $project: { roomName: 1, roomType: 1, totalRevenue: 1, bookingCount: 1, pricePerNight: 1 } }
            ]),
            Room.aggregate([
                { $match: roomFilter },
                { $lookup: {
                    from: 'bookings',
                    localField: '_id',
                    foreignField: 'room',
                    as: 'bookings'
                }},
                { $addFields: { bookingCount: { $size: '$bookings' } } },
                { $sort: { bookingCount: -1 } },
                { $limit: 10 },
                { $project: { roomName: 1, roomType: 1, bookingCount: 1, pricePerNight: 1 } }
            ]),
            Room.aggregate([
                { $match: roomFilter },
                { $bucket: {
                    groupBy: '$pricePerNight',
                    boundaries: [0, 500, 1000, 2000, 5000, 10000, 50000],
                    default: 'Other',
                    output: {
                        count: { $sum: 1 },
                        rooms: { $push: { roomName: '$roomName', roomType: '$roomType' } }
                    }
                }}
            ]),
            Room.aggregate([
                { $match: roomFilter },
                { $group: {
                    _id: null,
                    avgMaxAdults: { $avg: '$maxAdults' },
                    avgMaxChildren: { $avg: '$maxChildren' },
                    avgMaxGuests: { $avg: '$maxGuests' }
                }}
            ]),
            Booking.aggregate([
                { $match: { ...dateFilter } },
                { $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'roomDetails'
                }},
                { $unwind: '$roomDetails' },
                { $match: roomFilter },
                { $group: {
                    _id: { month: { $month: '$checkIn' }, quarter: { $quarter: '$checkIn' } },
                    bookings: { $sum: 1 },
                    revenue: { $sum: '$totalPrice' }
                }},
                { $sort: { '_id.month': 1 } }
            ])
        ]);

        res.json({
            overview: {
                totalRooms,
                roomsByStatus,
                roomsByType,
                averageDailyRate: averageDailyRate[0]?.avgDailyRate || 0,
                revPAR: revenuePerAvailableRoom[0]?.revPAR || 0
            },
            trends: {
                occupancyTrend,
                revenueTrend,
                bookingTrend
            },
            performance: {
                topRoomsByRevenue,
                topRoomsByBookings,
                roomsByPriceRange
            },
            utilization: {
                capacityUtilization,
                seasonalTrends
            },
            filters: {
                startDate: startDate || null,
                endDate: endDate || null,
                hotelId: hotelId || null,
                roomType: roomType || null,
                groupBy
            }
        });
    } catch (error) {
        console.error('Get all room analytics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== GET SYSTEM ROOM STATISTICS ====================
router.get('/admin/rooms/system-stats', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN can view system statistics
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN only.' });
        }

        const [
            totalRooms,
            totalHotels,
            totalHotelsWithRooms,
            averageRoomsPerHotel,
            totalRoomTypes,
            roomTypeDistribution,
            statusDistribution,
            availabilityDistribution,
            pricingStats,
            capacityStats,
            roomsAddedByMonth,
            mostExpensiveRooms,
            cheapestRooms,
            largestRooms,
            highestRatedRooms,
            roomsNeverBooked
        ] = await Promise.all([
            Room.countDocuments(),
            Hotel.countDocuments(),
            Hotel.countDocuments({ rooms: { $exists: true, $ne: [] } }),
            Room.aggregate([
                { $group: { _id: '$hotel', count: { $sum: 1 } } },
                { $group: { _id: null, avg: { $avg: '$count' } } }
            ]),
            Room.distinct('roomType'),
            Room.aggregate([
                { $group: { _id: '$roomType', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            Room.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Room.aggregate([
                { $group: { 
                    _id: '$isActive', 
                    count: { $sum: 1 },
                    totalAvailable: { $sum: '$availableRooms' },
                    totalCapacity: { $sum: '$totalRooms' }
                } }
            ]),
            Room.aggregate([
                { $group: {
                    _id: null,
                    minPrice: { $min: '$pricePerNight' },
                    maxPrice: { $max: '$pricePerNight' },
                    avgPrice: { $avg: '$pricePerNight' },
                    medianPrice: { $avg: '$pricePerNight' }
                }}
            ]),
            Room.aggregate([
                { $group: {
                    _id: null,
                    avgMaxAdults: { $avg: '$maxAdults' },
                    avgMaxChildren: { $avg: '$maxChildren' },
                    avgMaxGuests: { $avg: '$maxGuests' },
                    totalCapacity: { $sum: '$maxGuests' }
                }}
            ]),
            Room.aggregate([
                { $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    count: { $sum: 1 }
                }},
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 12 }
            ]),
            Room.find()
                .sort({ pricePerNight: -1 })
                .limit(5)
                .populate('hotel', 'name')
                .select('roomName roomType pricePerNight hotel'),
            Room.find()
                .sort({ pricePerNight: 1 })
                .limit(5)
                .populate('hotel', 'name')
                .select('roomName roomType pricePerNight hotel'),
            Room.find()
                .sort({ roomSize: -1 })
                .limit(5)
                .select('roomName roomType roomSize maxGuests'),
            Room.find({ averageRating: { $gt: 0 } })
                .sort({ averageRating: -1, totalReviews: -1 })
                .limit(5)
                .populate('hotel', 'name')
                .select('roomName roomType averageRating totalReviews hotel'),
            Room.aggregate([
                { $lookup: {
                    from: 'bookings',
                    localField: '_id',
                    foreignField: 'room',
                    as: 'bookings'
                }},
                { $match: { bookings: { $size: 0 } } },
                { $limit: 10 },
                { $project: { roomName: 1, roomType: 1, hotel: 1, pricePerNight: 1 } }
            ])
        ]);

        const activeCount = availabilityDistribution.find(a => a._id === true)?.count || 0;
        const inactiveCount = availabilityDistribution.find(a => a._id === false)?.count || 0;
        const totalAvailableCapacity = availabilityDistribution.find(a => a._id === true)?.totalAvailable || 0;
        const totalSystemCapacity = availabilityDistribution.find(a => a._id === true)?.totalCapacity || 0;

        res.json({
            systemOverview: {
                totalRooms,
                totalHotels,
                totalHotelsWithRooms,
                averageRoomsPerHotel: averageRoomsPerHotel[0]?.avg.toFixed(2) || 0,
                totalRoomTypes: totalRoomTypes.length,
                roomTypeDistribution,
                statusDistribution,
                activeRooms: activeCount,
                inactiveRooms: inactiveCount,
                systemUtilization: totalSystemCapacity > 0 ? ((totalAvailableCapacity / totalSystemCapacity) * 100).toFixed(2) : 0
            },
            pricing: {
                minPrice: pricingStats[0]?.minPrice || 0,
                maxPrice: pricingStats[0]?.maxPrice || 0,
                averagePrice: pricingStats[0]?.avgPrice.toFixed(2) || 0,
                medianPrice: pricingStats[0]?.medianPrice.toFixed(2) || 0
            },
            capacity: {
                averageMaxAdults: capacityStats[0]?.avgMaxAdults.toFixed(1) || 0,
                averageMaxChildren: capacityStats[0]?.avgMaxChildren.toFixed(1) || 0,
                averageMaxGuests: capacityStats[0]?.avgMaxGuests.toFixed(1) || 0,
                totalGuestCapacity: capacityStats[0]?.totalCapacity || 0
            },
            leaders: {
                mostExpensiveRooms,
                cheapestRooms,
                largestRooms,
                highestRatedRooms
            },
            insights: {
                roomsNeverBooked: roomsNeverBooked.length,
                roomsNeverBookedList: roomsNeverBooked,
                roomsAddedLast12Months: roomsAddedByMonth
            },
            generatedAt: new Date()
        });
    } catch (error) {
        console.error('Get system room statistics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ROOM PERFORMANCE REPORT ====================
router.get('/admin/rooms/performance-report', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can view performance reports
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const {
            startDate,
            endDate,
            hotelId,
            roomType,
            minBookings,
            sortBy = 'revenue',
            limit = 20
        } = req.query;

        const dateFilter = {};
        if (startDate) dateFilter.$gte = new Date(startDate);
        if (endDate) dateFilter.$lte = new Date(endDate);

        const roomFilter = {};
        if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) roomFilter.hotel = hotelId;
        if (roomType && roomType !== 'all') roomFilter.roomType = roomType;

        const rooms = await Room.aggregate([
            { $match: roomFilter },
            { $lookup: {
                from: 'bookings',
                localField: '_id',
                foreignField: 'room',
                as: 'allBookings'
            }},
            { $addFields: {
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
                pendingBookings: {
                    $size: {
                        $filter: {
                            input: '$allBookings',
                            cond: { $eq: ['$$this.status', 'PENDING'] }
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
                upcomingBookings: {
                    $size: {
                        $filter: {
                            input: '$allBookings',
                            cond: { 
                                $and: [
                                    { $eq: ['$$this.status', 'CONFIRMED'] },
                                    { $gte: ['$$this.checkIn', new Date()] }
                                ]
                            }
                        }
                    }
                }
            }},
            { $match: minBookings ? { totalBookingsCount: { $gte: parseInt(minBookings) } } : {} },
            { $addFields: {
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
                },
                conversionRate: {
                    $multiply: [
                        { $divide: ['$completedBookings', { $ifNull: ['$totalBookingsCount', 1] }] },
                        100
                    ]
                }
            }},
            { $sort: { [sortBy]: -1 } },
            { $limit: parseInt(limit) },
            { $lookup: {
                from: 'hotels',
                localField: 'hotel',
                foreignField: '_id',
                as: 'hotelDetails'
            }},
            { $unwind: '$hotelDetails' },
            { $project: {
                _id: 1,
                roomName: 1,
                roomNumber: 1,
                roomType: 1,
                pricePerNight: 1,
                discountPrice: 1,
                maxGuests: 1,
                totalRooms: 1,
                availableRooms: 1,
                status: 1,
                isActive: 1,
                averageRating: 1,
                totalReviews: 1,
                hotel: {
                    _id: '$hotelDetails._id',
                    name: '$hotelDetails.name',
                    starRating: '$hotelDetails.starRating'
                },
                totalBookings: '$totalBookingsCount',
                completedBookings: 1,
                cancelledBookings: 1,
                pendingBookings: 1,
                upcomingBookings: 1,
                totalRevenue: 1,
                occupancyRate: 1,
                revenuePerBooking: 1,
                conversionRate: 1
            }}
        ]);

        // Calculate summary statistics
        const summary = {
            totalRoomsInReport: rooms.length,
            totalRevenue: rooms.reduce((sum, r) => sum + (r.totalRevenue || 0), 0),
            totalBookings: rooms.reduce((sum, r) => sum + (r.totalBookings || 0), 0),
            averageOccupancy: rooms.reduce((sum, r) => sum + (r.occupancyRate || 0), 0) / rooms.length,
            averageConversionRate: rooms.reduce((sum, r) => sum + (r.conversionRate || 0), 0) / rooms.length,
            topPerformer: rooms[0]?.roomName || 'N/A',
            worstPerformer: rooms[rooms.length - 1]?.roomName || 'N/A'
        };

        // Generate insights
        const insights = {
            highPerformingRooms: rooms.filter(r => r.occupancyRate > 70),
            lowPerformingRooms: rooms.filter(r => r.occupancyRate < 30),
            revenueDrivers: rooms.filter(r => r.totalRevenue > summary.totalRevenue / rooms.length),
            improvementNeeded: rooms.filter(r => r.conversionRate < 50)
        };

        res.json({
            report: {
                generatedAt: new Date(),
                dateRange: { startDate: startDate || 'All time', endDate: endDate || 'Present' },
                summary,
                insights,
                rooms
            }
        });
    } catch (error) {
        console.error('Room performance report error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MANAGE HOTEL ROOMS ====================
router.get('/admin/hotels/:hotelId/rooms/manage', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can manage hotel rooms
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { hotelId } = req.params;
        const {
            page = 1,
            limit = 20,
            status,
            roomType,
            sortBy = 'roomNumber',
            sortOrder = 'asc'
        } = req.query;

        if (!mongoose.Types.ObjectId.isValid(hotelId)) {
            return res.status(400).json({ error: 'Invalid hotel ID' });
        }

        const hotel = await Hotel.findById(hotelId).select('name owner starRating status');
        if (!hotel) {
            return res.status(404).json({ error: 'Hotel not found' });
        }

        const query = { hotel: hotelId };
        if (status && status !== 'all') query.status = status;
        if (roomType && roomType !== 'all') query.roomType = roomType;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [rooms, totalCount] = await Promise.all([
            Room.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit)),
            Room.countDocuments(query)
        ]);

        // Get room statistics
        const roomStats = await Room.aggregate([
            { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
            { $group: {
                _id: null,
                totalRooms: { $sum: 1 },
                totalAvailable: { $sum: '$availableRooms' },
                totalCapacity: { $sum: '$totalRooms' },
                avgPrice: { $avg: '$pricePerNight' },
                byStatus: { $push: '$status' }
            }}
        ]);

        res.json({
            hotel: {
                id: hotel._id,
                name: hotel.name,
                owner: hotel.owner,
                starRating: hotel.starRating,
                status: hotel.status
            },
            summary: {
                totalRooms: roomStats[0]?.totalRooms || 0,
                totalAvailableRooms: roomStats[0]?.totalAvailable || 0,
                totalCapacity: roomStats[0]?.totalCapacity || 0,
                averagePrice: roomStats[0]?.avgPrice.toFixed(2) || 0,
                occupancyRate: roomStats[0]?.totalCapacity > 0 
                    ? ((roomStats[0].totalCapacity - roomStats[0].totalAvailable) / roomStats[0].totalCapacity * 100).toFixed(1)
                    : 0
            },
            rooms,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalRooms: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Manage hotel rooms error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MANAGE ROOM AVAILABILITY ====================
router.post('/admin/rooms/manage-availability', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can manage availability
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { roomIds, availableRooms, operation } = req.body;

        if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of room IDs' });
        }

        const validIds = roomIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        const results = [];

        for (const roomId of validIds) {
            const room = await Room.findById(roomId);
            if (!room) continue;

            let newAvailableRooms = room.availableRooms;

            if (operation === 'increase') {
                if (room.availableRooms < room.totalRooms) {
                    newAvailableRooms = room.availableRooms + 1;
                }
            } else if (operation === 'decrease') {
                if (room.availableRooms > 0) {
                    newAvailableRooms = room.availableRooms - 1;
                }
            } else if (availableRooms !== undefined) {
                newAvailableRooms = Math.min(Math.max(availableRooms, 0), room.totalRooms);
            } else {
                continue;
            }

            const newStatus = newAvailableRooms === 0 ? 'FULLY_BOOKED' : 'AVAILABLE';

            await Room.updateOne(
                { _id: roomId },
                { 
                    $set: { 
                        availableRooms: newAvailableRooms,
                        status: newStatus
                    } 
                }
            );

            results.push({
                roomId,
                roomName: room.roomName,
                previousAvailability: room.availableRooms,
                newAvailability: newAvailableRooms,
                status: newStatus
            });
        }

        res.json({
            message: `Updated availability for ${results.length} rooms`,
            results
        });
    } catch (error) {
        console.error('Manage room availability error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MANAGE ROOM STATUS ====================
router.post('/admin/rooms/manage-status', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        // Only SUPER_ADMIN and ADMIN can manage status
        if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

        const { updates } = req.body;

        if (!updates || !Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of updates with roomId and status' });
        }

        const validStatuses = ['AVAILABLE', 'FULLY_BOOKED', 'MAINTENANCE', 'INACTIVE'];
        const results = [];
        const errors = [];

        for (const update of updates) {
            const { roomId, status, reason } = update;

            if (!mongoose.Types.ObjectId.isValid(roomId)) {
                errors.push({ roomId, error: 'Invalid room ID' });
                continue;
            }

            if (!validStatuses.includes(status)) {
                errors.push({ roomId, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
                continue;
            }

            const room = await Room.findById(roomId);
            if (!room) {
                errors.push({ roomId, error: 'Room not found' });
                continue;
            }

            // Check for active bookings when setting maintenance or inactive
            if (status === 'MAINTENANCE' || status === 'INACTIVE') {
                const activeBookings = await Booking.countDocuments({
                    room: roomId,
                    status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
                });
                if (activeBookings > 0) {
                    errors.push({ roomId, error: `Has ${activeBookings} active bookings` });
                    continue;
                }
            }

            const updateData = { status };
            if (status === 'MAINTENANCE') {
                updateData.isActive = false;
                updateData.availableRooms = 0;
                if (reason) updateData.maintenanceReason = reason;
            } else if (status === 'INACTIVE') {
                updateData.isActive = false;
                updateData.availableRooms = 0;
            } else if (status === 'AVAILABLE') {
                updateData.isActive = true;
                if (room.availableRooms === 0 && room.totalRooms > 0) {
                    updateData.availableRooms = room.totalRooms;
                }
            } else if (status === 'FULLY_BOOKED') {
                updateData.availableRooms = 0;
            }

            await Room.updateOne({ _id: roomId }, { $set: updateData });

            results.push({
                roomId,
                roomName: room.roomName,
                previousStatus: room.status,
                newStatus: status
            });
        }

        res.json({
            message: `Updated status for ${results.length} rooms`,
            results,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Manage room status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});












////////////////////////// Super Admin //////////////////////////
////////////////////////// Super Admin //////////////////////////



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
            { $lookup: {
                from: 'hotels',
                localField: 'hotels',
                foreignField: '_id',
                as: 'hotelDetails'
            }},
            { $addFields: {
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
            }},
            { $sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 } },
            { $skip: (parseInt(page) - 1) * parseInt(limit) },
            { $limit: parseInt(limit) },
            { $project: {
                password: 0,
                resetPasswordToken: 0,
                resetPasswordExpiry: 0,
                emailVerificationToken: 0,
                emailVerificationExpiry: 0
            }}
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
            .select('-passwor -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry')
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
        ).select('-password -resetPasswordToken -resetPasswordExpiry -emailVerificationToken -emailVerificationExpiry');

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
                { $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    revenue: { $sum: '$totalPrice' }
                }},
                { $sort: { '_id.year': -1, '_id.month': -1 } },
                { $limit: 6 }
            ]),
            Booking.aggregate([
                { $match: { hotel: { $in: hotelIds }, ...dateFilter } },
                { $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    count: { $sum: 1 }
                }},
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
                { $group: {
                    _id: { month: { $month: '$createdAt' }, week: { $week: '$createdAt' } },
                    bookings: { $sum: 1 },
                    revenue: { $sum: '$totalPrice' }
                }},
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
                { $group: {
                    _id: '$hotelCount',
                    count: { $sum: 1 }
                }},
                { $sort: { _id: 1 } }
            ]),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                { $lookup: {
                    from: 'hotels',
                    localField: 'hotels',
                    foreignField: '_id',
                    as: 'hotelDetails'
                }},
                { $addFields: {
                    totalRevenue: {
                        $sum: {
                            $map: {
                                input: '$hotelDetails',
                                as: 'hotel',
                                in: { $ifNull: ['$$hotel.totalRevenue', 0] }
                            }
                        }
                    }
                }},
                { $group: {
                    _id: null,
                    total: { $sum: '$totalRevenue' },
                    avg: { $avg: '$totalRevenue' }
                }}
            ]),
            User.aggregate([
                { $match: { hotels: { $exists: true, $ne: [] } } },
                { $lookup: {
                    from: 'hotels',
                    localField: 'hotels',
                    foreignField: '_id',
                    as: 'hotelDetails'
                }},
                { $addFields: {
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
                }},
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
                { $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    count: { $sum: 1 }
                }},
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