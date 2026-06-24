const checkSuperAdmin = (req, res, next) => {
    try{
        if(!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if(req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. Super Admin privileges required.' });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = checkSuperAdmin;