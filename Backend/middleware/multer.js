const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const createUploadDirectories = () => {
    const dirs = [
        'uploads/profiles',
        'uploads/hotels/thumbnails',
        'uploads/hotels/gallery',
        'uploads/rooms/thumbnails',
        'uploads/rooms/gallery'
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

createUploadDirectories();

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath = 'uploads/';

        // User profile images
        if (file.fieldname === 'profileImage' || file.fieldname === 'image') {
            uploadPath += 'profiles/';
        } 
        // Hotel images
        else if (file.fieldname === 'hotelThumbnail' || file.fieldname === 'thumbnail') {
            uploadPath += 'hotels/thumbnails/';
        } 
        else if (file.fieldname === 'hotelGallery' || file.fieldname === 'gallery') {
            uploadPath += 'hotels/gallery/';
        }
        // Room images
        else if (file.fieldname === 'roomThumbnail' || file.fieldname === 'thumbnail') {
            uploadPath += 'rooms/thumbnails/';
        } 
        else if (file.fieldname === 'roomGallery' || file.fieldname === 'gallery') {
            uploadPath += 'rooms/gallery/';
        } 
        else {
            uploadPath += 'others/';
        }

        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Generate unique filename with original name
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, extension);
        cb(null, baseName + '-' + uniqueSuffix + extension);
    }
});





// File filter function for images only
const fileFilter = (req, file, cb) => {
    // Allow only image files
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        files: 10
    }
});

// ------------------- USER PROFILE IMAGE UPLOAD -------------------
// Single file upload for profile image
const uploadUserProfile = upload.single('profileImage');

// Alternative upload for profile image with 'image' field name
const uploadUserProfileAlt = upload.single('image');

// Middleware to handle both field names flexibly for profile
const uploadProfileImageFlexible = (req, res, next) => {
    upload.single('profileImage')(req, res, (err) => {
        if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
            upload.single('image')(req, res, next);
        } else {
            next(err);
        }
    });
};

// ------------------- HOTEL IMAGE UPLOAD -------------------
// Single hotel thumbnail upload
const uploadHotelThumbnail = upload.single('hotelThumbnail');

// Multiple hotel gallery images upload (max 10)
const uploadHotelGallery = upload.array('hotelGallery', 10);

// Flexible hotel thumbnail upload (handles both 'hotelThumbnail' and 'thumbnail')
const uploadHotelThumbnailFlexible = (req, res, next) => {
    upload.single('hotelThumbnail')(req, res, (err) => {
        if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
            upload.single('thumbnail')(req, res, next);
        } else {
            next(err);
        }
    });
};

// Flexible hotel gallery upload (handles both 'hotelGallery' and 'gallery')
const uploadHotelGalleryFlexible = (req, res, next) => {
    upload.array('hotelGallery', 10)(req, res, (err) => {
        if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
            upload.array('gallery', 10)(req, res, next);
        } else {
            next(err);
        }
    });
};

// Combined hotel image upload (thumbnail + gallery)
const uploadHotelImages = upload.fields([
    { name: 'hotelThumbnail', maxCount: 1 },
    { name: 'hotelGallery', maxCount: 10 }
]);

// Flexible combined hotel image upload
const uploadHotelImagesFlexible = (req, res, next) => {
    upload.fields([
        { name: 'hotelThumbnail', maxCount: 1 },
        { name: 'hotelGallery', maxCount: 10 }
    ])(req, res, (err) => {
        if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
            upload.fields([
                { name: 'thumbnail', maxCount: 1 },
                { name: 'gallery', maxCount: 10 }
            ])(req, res, next);
        } else {
            next(err);
        }
    });
};

// ------------------- ROOM IMAGE UPLOAD -------------------
// Single room thumbnail upload
const uploadRoomThumbnail = upload.single('roomThumbnail');

// Multiple room gallery images upload (max 10)
const uploadRoomGallery = upload.array('roomGallery', 10);

// Flexible room thumbnail upload (handles both 'roomThumbnail' and 'thumbnail')
const uploadRoomThumbnailFlexible = (req, res, next) => {
    upload.single('roomThumbnail')(req, res, (err) => {
        if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
            upload.single('thumbnail')(req, res, next);
        } else {
            next(err);
        }
    });
};

// Flexible room gallery upload (handles both 'roomGallery' and 'gallery')
const uploadRoomGalleryFlexible = (req, res, next) => {
    upload.array('roomGallery', 10)(req, res, (err) => {
        if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
            upload.array('gallery', 10)(req, res, next);
        } else {
            next(err);
        }
    });
};

// Combined room image upload (thumbnail + gallery)
const uploadRoomImages = upload.fields([
    { name: 'roomThumbnail', maxCount: 1 },
    { name: 'roomGallery', maxCount: 10 }
]);

// Flexible combined room image upload
const uploadRoomImagesFlexible = (req, res, next) => {
    upload.fields([
        { name: 'roomThumbnail', maxCount: 1 },
        { name: 'roomGallery', maxCount: 10 }
    ])(req, res, (err) => {
        if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
            upload.fields([
                { name: 'thumbnail', maxCount: 1 },
                { name: 'gallery', maxCount: 10 }
            ])(req, res, next);
        } else {
            next(err);
        }
    });
};

// ------------------- ERROR HANDLING -------------------
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 5MB.'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files uploaded. Maximum is 10 files.'
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                error: 'Unexpected field name for file upload. Please use correct field names.'
            });
        }
        return res.status(400).json({
            success: false,
            error: err.message
        });
    } else if (err) {
        return res.status(400).json({
            success: false,
            error: err.message
        });
    }
    next();
};

module.exports = {
    upload,
    // User profile uploads
    uploadUserProfile,
    uploadUserProfileAlt,
    uploadProfileImageFlexible,
    // Hotel uploads
    uploadHotelThumbnail,
    uploadHotelGallery,
    uploadHotelThumbnailFlexible,
    uploadHotelGalleryFlexible,
    uploadHotelImages,
    uploadHotelImagesFlexible,
    // Room uploads
    uploadRoomThumbnail,
    uploadRoomGallery,
    uploadRoomThumbnailFlexible,
    uploadRoomGalleryFlexible,
    uploadRoomImages,
    uploadRoomImagesFlexible,
    // Error handler
    handleMulterError
};

