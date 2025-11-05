var express = require('express');
var Task = require('../models/task');
var User = require('../models/user');

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

    // GET /tasks
    r.get('/', async function (req, res) {
        try {
            var built = buildQuery(Task, req, 100); // default tasks limit 100
            if (built.countOnly) {
                var c = await Task.countDocuments(built.where);
                return res.status(200).json({ message: 'OK', data: c });
            }
            var tasks = await built.query.exec();
            return res.status(200).json({ message: 'OK', data: tasks });
        } catch (err) {
            return res.status(400).json({ message: 'Bad Request', data: err.message });
        }
    });

    // POST /tasks
    r.post('/', async function (req, res) {
        try {
            var body = req.body || {};
            if (!body.name || !body.deadline) {
                return res.status(400).json({ message: 'Task must have name and deadline', data: null });
            }
            var task = new Task({
                name: body.name,
                description: body.description || '',
                deadline: body.deadline,
                completed: !!body.completed,
                assignedUser: body.assignedUser || '',
                assignedUserName: body.assignedUserName || 'unassigned'
            });

            // If assignedUser provided, validate and sync user pendingTasks
            if (task.assignedUser) {
                var user = await User.findById(task.assignedUser);
                if (!user) {
                    return res.status(400).json({ message: 'Assigned user not found', data: null });
                }
                task.assignedUserName = user.name;
                await task.save();
                await User.updateOne({ _id: user._id }, { $addToSet: { pendingTasks: task._id.toString() } }).exec();
            } else {
                await task.save();
                task.assignedUserName = 'unassigned';
            }

            return res.status(201).json({ message: 'Task created', data: task });
        } catch (err) {
            return res.status(400).json({ message: 'Failed to create task', data: null });
        }
    });

    // GET /tasks/:id
    r.get('/:id', async function (req, res) {
        try {
            var select = parseJSONParam(req.query.select) || undefined;
            var q = Task.findById(req.params.id);
            if (select) q = q.select(select);
            var task = await q.exec();
            if (!task) return res.status(404).json({ message: 'Task not found', data: null });
            return res.status(200).json({ message: 'OK', data: task });
        } catch (err) {
            return res.status(400).json({ message: 'Bad Request', data: err.message });
        }
    });

    // PUT /tasks/:id (replace entire task)
    r.put('/:id', async function (req, res) {
        var body = req.body || {};
        if (!body.name || !body.deadline) {
            return res.status(400).json({ message: 'Task must have name and deadline', data: null });
        }
        try {
            var task = await Task.findById(req.params.id);
            if (!task) return res.status(404).json({ message: 'Task not found', data: null });

            var prevAssignedUser = task.assignedUser;

            // Update fields
            task.name = body.name;
            task.description = body.description || '';
            task.deadline = body.deadline;
            task.completed = !!body.completed;
            task.assignedUser = body.assignedUser || '';

            if (task.assignedUser) {
                var newUser = await User.findById(task.assignedUser);
                if (!newUser) {
                    return res.status(400).json({ message: 'Assigned user not found', data: null });
                }
                task.assignedUserName = newUser.name;
                await task.save();
                // Remove from previous user's pendingTasks if changed
                if (prevAssignedUser && prevAssignedUser !== newUser._id.toString()) {
                    await User.updateOne({ _id: prevAssignedUser }, { $pull: { pendingTasks: task._id.toString() } }).exec();
                }
                // Ensure present in new user's pendingTasks
                await User.updateOne({ _id: newUser._id }, { $addToSet: { pendingTasks: task._id.toString() } }).exec();
            } else {
                // Unassign
                task.assignedUserName = 'unassigned';
                await task.save();
                if (prevAssignedUser) {
                    await User.updateOne({ _id: prevAssignedUser }, { $pull: { pendingTasks: task._id.toString() } }).exec();
                }
            }

            return res.status(200).json({ message: 'Task updated', data: task });
        } catch (err) {
            return res.status(400).json({ message: 'Failed to update task', data: null });
        }
    });

    // DELETE /tasks/:id
    r.delete('/:id', async function (req, res) {
        try {
            var task = await Task.findById(req.params.id);
            if (!task) return res.status(404).json({ message: 'Task not found', data: null });

            if (task.assignedUser) {
                await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: task._id.toString() } }).exec();
            }

            await Task.deleteOne({ _id: task._id });
            return res.status(200).json({ message: 'Task deleted', data: task });
        } catch (err) {
            return res.status(500).json({ message: 'Failed to delete task', data: null });
        }
    });

    return r;
};


