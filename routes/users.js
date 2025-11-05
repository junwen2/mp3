var express = require('express');
var User = require('../models/user');
var Task = require('../models/task');

function parseJSONParam(param) {
    if (!param) return undefined;
    try { return JSON.parse(param); } catch (e) { return undefined; }
}

function buildQuery(model, req, defaultLimit) {
    var where = parseJSONParam(req.query.where) || {};
    var sort = parseJSONParam(req.query.sort) || undefined;
    var select = parseJSONParam(req.query.select || req.query.filter) || undefined;
    var skip = req.query.skip ? parseInt(req.query.skip) : undefined;
    var limit = req.query.limit ? parseInt(req.query.limit) : defaultLimit;
    var countOnly = String(req.query.count).toLowerCase() === 'true';

    var q = model.find(where);
    if (sort) q = q.sort(sort);
    if (select) q = q.select(select);
    if (typeof skip === 'number' && !isNaN(skip)) q = q.skip(skip);
    if (typeof limit === 'number' && !isNaN(limit)) q = q.limit(limit);

    return { query: q, countOnly: countOnly, where: where, select: select };
}

module.exports = function (router) {
    var r = express.Router();

    // GET /users
    r.get('/', async function (req, res) {
        try {
            var built = buildQuery(User, req, undefined); // unlimited by default
            if (built.countOnly) {
                var c = await User.countDocuments(built.where);
                return res.status(200).json({ message: 'OK', data: c });
            }
            var users = await built.query.exec();
            return res.status(200).json({ message: 'OK', data: users });
        } catch (err) {
            return res.status(400).json({ message: 'Bad Request', data: err.message });
        }
    });

    // POST /users
    r.post('/', async function (req, res) {
        try {
            var body = req.body || {};
            if (!body.name || !body.email) {
                return res.status(400).json({ message: 'User must have name and email', data: null });
            }
            var user = new User({
                name: body.name,
                email: body.email,
                pendingTasks: Array.isArray(body.pendingTasks) ? body.pendingTasks : [],
            });
            await user.save();
            return res.status(201).json({ message: 'User created', data: user });
        } catch (err) {
            var msg = err && err.code === 11000 ? 'Email already exists' : 'Failed to create user';
            return res.status(400).json({ message: msg, data: null });
        }
    });

    // GET /users/:id
    r.get('/:id', async function (req, res) {
        try {
            var select = parseJSONParam(req.query.select) || undefined;
            var q = User.findById(req.params.id);
            if (select) q = q.select(select);
            var user = await q.exec();
            if (!user) return res.status(404).json({ message: 'User not found', data: null });
            return res.status(200).json({ message: 'OK', data: user });
        } catch (err) {
            return res.status(400).json({ message: 'Bad Request', data: err.message });
        }
    });

    // PUT /users/:id (replace entire user)
    r.put('/:id', async function (req, res) {
        var body = req.body || {};
        if (!body.name || !body.email) {
            return res.status(400).json({ message: 'User must have name and email', data: null });
        }
        try {
            var user = await User.findById(req.params.id);
            if (!user) return res.status(404).json({ message: 'User not found', data: null });

            // Capture current tasks
            var previousTaskIds = new Set(user.pendingTasks || []);
            var newTaskIds = new Set(Array.isArray(body.pendingTasks) ? body.pendingTasks : []);

            // Update core fields
            user.name = body.name;
            user.email = body.email;
            user.pendingTasks = Array.from(newTaskIds);
            await user.save();

            // Tasks to remove (previous - new)
            var toUnassign = Array.from(previousTaskIds).filter(function (id) { return !newTaskIds.has(id); });
            // Tasks to add (new - previous)
            var toAssign = Array.from(newTaskIds).filter(function (id) { return !previousTaskIds.has(id); });

            // Unassign removed tasks
            await Task.updateMany({ _id: { $in: toUnassign }, assignedUser: user._id.toString() }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } }).exec();

            // For tasks to assign, ensure reassignment and remove from other users
            for (var i = 0; i < toAssign.length; i++) {
                var tId = toAssign[i];
                var task = await Task.findById(tId);
                if (!task) continue;
                if (task.assignedUser && task.assignedUser !== user._id.toString()) {
                    // remove from previous user's pendingTasks
                    await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: task._id.toString() } }).exec();
                }
                task.assignedUser = user._id.toString();
                task.assignedUserName = user.name;
                await task.save();
            }

            return res.status(200).json({ message: 'User updated', data: user });
        } catch (err) {
            var msg = err && err.code === 11000 ? 'Email already exists' : 'Failed to update user';
            return res.status(400).json({ message: msg, data: null });
        }
    });

    // DELETE /users/:id
    r.delete('/:id', async function (req, res) {
        try {
            var user = await User.findById(req.params.id);
            if (!user) return res.status(404).json({ message: 'User not found', data: null });

            // Unassign user's tasks
            await Task.updateMany({ assignedUser: user._id.toString() }, { $set: { assignedUser: '', assignedUserName: 'unassigned' } }).exec();

            await User.deleteOne({ _id: user._id });
            return res.status(200).json({ message: 'User deleted', data: user });
        } catch (err) {
            return res.status(500).json({ message: 'Failed to delete user', data: null });
        }
    });

    return r;
};


