const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.set('trust proxy', 1);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: 'Too many requests, please try again later.' }
});

app.use(cors({
    origin: [
        'https://town-admin-production.up.railway.app',
        'https://t.me',
        'https://web.telegram.org'
    ]
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));
app.use('/api/', limiter);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '12345';
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID) || 1891231976;
const BOT_TOKEN = process.env.BOT_TOKEN;

function validateUserId(userId) {
    return userId && typeof userId === 'number' && userId > 0;
}

function validateString(value, maxLength = 255) {
    return value && typeof value === 'string' && value.length <= maxLength;
}

function validateNumber(value, min = 0, max = Infinity) {
    return typeof value === 'number' && value >= min && value <= max;
}

function getServerTime() {
    return Date.now();
}

async function notifyUser(userId, message, buttons = null) {
    try {
        if (!BOT_TOKEN) return false;
        
        const payload = {
            chat_id: userId,
            text: message,
            parse_mode: 'HTML'
        };
        
        if (buttons && buttons.length > 0) {
            payload.reply_markup = {
                inline_keyboard: [buttons.map(btn => ({
                    text: btn.text,
                    url: btn.url
                }))]
            };
        }
        
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        console.log(`📤 [notifyUser] User ${userId}:`, data.ok ? 'Sent' : 'Failed', data.description);
        return data.ok;
    } catch (error) {
        console.error('❌ [notifyUser] Error:', error.message);
        return false;
    }
}

async function notifyAdmin(message) {
    try {
        if (!ADMIN_CHAT_ID || !BOT_TOKEN) return false;
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });
        const data = await response.json();
        return data.ok;
    } catch (error) {
        console.error('❌ [notifyAdmin] Error:', error.message);
        return false;
    }
}

async function sendPromoToChannel(channelId, code, reward, rewardType, total, userLink) {
    try {
        if (!BOT_TOKEN) return { success: false, error: 'Bot not configured' };
        if (!channelId) return { success: false, error: 'Channel ID required' };

        const PROMO_IMAGE_URL = 'https://i.ibb.co/W4FRWY3z/c53854a65b5a.jpg';

        let chatId = channelId;
        const channelMatch = channelId.match(/t\.me\/([^\/\?]+)/);
        if (channelMatch) {
            chatId = '@' + channelMatch[1];
        }

        if (!chatId.startsWith('@') && !chatId.startsWith('-100') && !chatId.startsWith('https://')) {
            if (!isNaN(chatId)) {
                chatId = '-100' + chatId;
            }
        }

        if (chatId.startsWith('https://')) {
            const match = chatId.match(/t\.me\/([^\/\?]+)/);
            if (match) {
                chatId = '@' + match[1];
            }
        }

        console.log(`📤 [sendPromoToChannel] Original: ${channelId} → Converted: ${chatId}`);

        const rewardLabel = rewardType === 'gold' ? 'GOLD' : 'POWER';
        const message = `<b>🆕 NEW PROMO CODE</b>\n\n` +
            `<b>🔰 CODE:</b> <code>${code}</code>\n` +
            `<b>🔰 REWARD:</b> ${reward} ${rewardLabel}\n` +
            `<b>🔰 PROGRESS:</b> 0/${total}\n\n` +
            `🏴‍☠️ <b>GRAM PIRATES | MINE & EARN</b>`;

        const buttons = userLink ? [
            { text: 'CLAIM NOW', url: userLink }
        ] : [];

        const replyMarkup = buttons.length > 0 ? {
            inline_keyboard: [buttons.map(btn => ({
                text: btn.text,
                url: btn.url
            }))]
        } : undefined;

        let response;
        if (PROMO_IMAGE_URL) {
            response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    photo: PROMO_IMAGE_URL,
                    caption: caption,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup,
                    disable_web_page_preview: true
                })
            });
        } else {
            response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: caption,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup,
                    disable_web_page_preview: true
                })
            });
        }

        const data = await response.json();
        if (data.ok) {
            console.log(`✅ [sendPromoToChannel] Sent to ${chatId}`);
            return { success: true };
        } else {
            console.log(`❌ [sendPromoToChannel] Failed: ${data.description}`);
            return { success: false, error: data.description || 'Unknown error' };
        }
    } catch (error) {
        console.error('❌ [sendPromoToChannel] Error:', error.message);
        return { success: false, error: error.message };
    }
}

async function getApprovedPromotions() {
    try {
        console.log('🔍 [getApprovedPromotions] Fetching approved promotions...');
        const { data, error } = await supabase
            .from('users')
            .select('id, first_name, promotion')
            .not('promotion', 'is', null)
            .contains('promotion', { status: 'approved' });

        if (error) throw error;
        console.log(`✅ [getApprovedPromotions] Found ${data?.length || 0} approved promotions`);
        
        const formattedData = (data || []).map(u => ({
            user_id: u.id,
            first_name: u.first_name || 'User',
            channel: u.promotion?.channel || null,
            link: u.promotion?.link || null,
            username: u.promotion?.username || null
        })).filter(p => p.channel);

        return formattedData;
    } catch (error) {
        console.error('❌ [getApprovedPromotions] Error:', error.message);
        return [];
    }
}

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

app.post('/api/admin/stats', async (req, res) => {
    try {
        const { count: totalUsers, error: usersError } = await supabase
            .from('users')
            .select('id', { count: 'exact', head: true });
        
        if (usersError) throw usersError;
        
        const { count: totalWithdrawals, error: withdrawalsError } = await supabase
            .from('withdrawals')
            .select('id', { count: 'exact', head: true });
        
        if (withdrawalsError) throw withdrawalsError;
        
        const { count: totalTasks, error: tasksError } = await supabase
            .from('tasks')
            .select('id', { count: 'exact', head: true });
        
        if (tasksError) throw tasksError;
        
        const { count: totalCodes, error: codesError } = await supabase
            .from('promo_codes')
            .select('code', { count: 'exact', head: true });
        
        if (codesError) throw codesError;
        
        res.json({
            success: true,
            data: {
                totalUsers: totalUsers || 0,
                totalWithdrawals: totalWithdrawals || 0,
                totalTasks: totalTasks || 0,
                totalCodes: totalCodes || 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/users/search', async (req, res) => {
    try {
        const { userId } = req.body;
        let query = supabase
            .from('users')
            .select('id, first_name, username, gold_balance, power_balance, level, total_referrals, state');
        
        if (typeof userId === 'number' && userId > 0) {
            query = query.eq('id', userId);
        } else if (typeof userId === 'string' && userId.length > 0) {
            query = query.ilike('username', userId);
        } else {
            return res.status(400).json({ success: false, error: 'Invalid user ID or username' });
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        if (data && data[0]) {
            data[0].gold_balance = parseFloat((data[0].gold_balance || 0).toFixed(5));
            data[0].power_balance = data[0].power_balance || 0;
            data[0].level = data[0].level || 1;
        }
        
        res.json({ success: true, data: data[0] || null });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/users/ban', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!validateUserId(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        const { error } = await supabase
            .from('users')
            .update({ state: 'ban' })
            .eq('id', userId);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/users/unban', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!validateUserId(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        const { error } = await supabase
            .from('users')
            .update({ state: 'active' })
            .eq('id', userId);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/balance/add', async (req, res) => {
    try {
        const { userId, amount, type } = req.body;
        
        if (!validateUserId(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        if (!validateNumber(amount, 0.000001)) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }
        if (!['gold_balance', 'power_balance'].includes(type)) {
            return res.status(400).json({ success: false, error: 'Invalid balance type' });
        }
        
        const { data: userData, error: fetchError } = await supabase
            .from('users')
            .select(type)
            .eq('id', userId)
            .single();
        
        if (fetchError || !userData) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const currentBalance = userData[type] || 0;
        const newBalance = type === 'gold_balance' 
            ? parseFloat((currentBalance + amount).toFixed(5))
            : currentBalance + amount;
        
        const { error } = await supabase
            .from('users')
            .update({ [type]: newBalance })
            .eq('id', userId);
        
        if (error) throw error;
        
        res.json({ success: true, newBalance });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/balance/deduct', async (req, res) => {
    try {
        const { userId, amount, type } = req.body;
        
        if (!validateUserId(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        if (!validateNumber(amount, 0.000001)) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }
        if (!['gold_balance', 'power_balance'].includes(type)) {
            return res.status(400).json({ success: false, error: 'Invalid balance type' });
        }
        
        const { data: userData, error: fetchError } = await supabase
            .from('users')
            .select(type)
            .eq('id', userId)
            .single();
        
        if (fetchError || !userData) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const currentBalance = userData[type] || 0;
        if (currentBalance < amount) {
            return res.status(400).json({ success: false, error: 'Insufficient balance' });
        }
        
        const newBalance = type === 'gold_balance' 
            ? parseFloat((currentBalance - amount).toFixed(5))
            : currentBalance - amount;
        
        const { error } = await supabase
            .from('users')
            .update({ [type]: newBalance })
            .eq('id', userId);
        
        if (error) throw error;
        
        res.json({ success: true, newBalance });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/tasks/create', async (req, res) => {
    try {
        const { name, url, category, reward, maxCompletions, owner, goldReward, verification } = req.body;
        
        if (!name || !url) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        if (!validateNumber(reward, 1)) {
            return res.status(400).json({ success: false, error: 'Invalid reward amount' });
        }
        if (!validateNumber(maxCompletions, 1)) {
            return res.status(400).json({ success: false, error: 'Invalid max completions' });
        }
        
        const taskData = {
            id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name,
            url,
            category: category || 'main',
            reward: parseInt(reward) || 100,
            total: maxCompletions || 100,
            total_completed: 0,
            status: 'active',
            owner: owner || 0,
            created_at: Date.now(),
            verification: verification !== undefined ? verification : true,
            notified: false
        };
        
        const { data, error } = await supabase
            .from('tasks')
            .insert([taskData])
            .select();
        
        if (error) throw error;
        res.json({ success: true, data: data[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/tasks/list', async (req, res) => {
    try {
        const { status, owner, category } = req.body;
        let query = supabase
            .from('tasks')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (status) query = query.eq('status', status);
        if (owner && validateUserId(owner)) query = query.eq('owner', owner);
        if (category) query = query.eq('category', category);
        
        const { data, error } = await query;
        if (error) throw error;
        
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/tasks/update', async (req, res) => {
    try {
        const { taskId, name, url, reward } = req.body;
        
        if (!taskId) {
            return res.status(400).json({ success: false, error: 'Task ID required' });
        }
        
        const updateData = {};
        if (name) updateData.name = name;
        if (url) updateData.url = url;
        if (reward !== undefined) {
            updateData.reward = parseInt(reward);
        }
        
        const { error } = await supabase
            .from('tasks')
            .update(updateData)
            .eq('id', taskId);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/tasks/update-status', async (req, res) => {
    try {
        const { taskId, status } = req.body;
        
        if (!taskId) {
            return res.status(400).json({ success: false, error: 'Task ID required' });
        }
        if (!['pending', 'active', 'rejected', 'completed'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }
        
        const { data: taskData, error: fetchError } = await supabase
            .from('tasks')
            .select('name, owner')
            .eq('id', taskId)
            .single();
        
        if (fetchError) throw fetchError;
        
        const { error } = await supabase
            .from('tasks')
            .update({ status: status })
            .eq('id', taskId);
        
        if (error) throw error;
        
        if (status === 'active' && taskData.owner && validateUserId(taskData.owner)) {
            await notifyUser(taskData.owner,
                `<b>✅ Task Approved</b>\n\n` +
                `<b>Task:</b> ${taskData.name}\n` +
                `<b>Status:</b> Active\n` +
                `<b>ℹ️ You can now complete this task.</b>`
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/tasks/delete', async (req, res) => {
    try {
        const { taskId } = req.body;
        if (!taskId) {
            return res.status(400).json({ success: false, error: 'Task ID required' });
        }
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', taskId);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/withdrawals/list', async (req, res) => {
    try {
        const { status, userId } = req.body;
        let query = supabase
            .from('withdrawals')
            .select('*')
            .order('timestamp', { ascending: false });
        
        if (status) {
            query = query.eq('status', status);
        } else {
            query = query.eq('status', 'pending');
        }
        
        if (userId && validateUserId(userId)) {
            query = query.eq('user_id', userId);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        if (data) {
            data.forEach(w => {
                w.amount = -Math.abs(parseFloat((w.amount || 0).toFixed(5)));
            });
        }
        
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/withdrawals/update-status', async (req, res) => {
    try {
        const { transactionId, status } = req.body;
        
        if (!transactionId) {
            return res.status(400).json({ success: false, error: 'Transaction ID required' });
        }
        if (!['pending', 'completed', 'rejected', 'failed'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }
        
        const { data: txData, error: fetchError } = await supabase
            .from('withdrawals')
            .select('user_id, amount')
            .eq('id', transactionId)
            .single();
        
        if (fetchError) throw fetchError;
        
        const absAmount = -Math.abs(txData.amount || 0);
        
        const { error } = await supabase
            .from('withdrawals')
            .update({
                status: status,
                amount: parseFloat(absAmount.toFixed(5))
            })
            .eq('id', transactionId);
        
        if (error) throw error;
        
        if (status === 'completed') {
            await notifyUser(txData.user_id,
                `<b>✅ Withdrawal Completed!</b>\n\n` +
                `<b>💎 Amount:</b> ${parseFloat(Math.abs(txData.amount).toFixed(5))} GRAM\n` +
                `<b>ℹ️ Check your wallet.</b>`
            );
            
            await notifyAdmin(
                `<b>💰 Withdrawal Completed</b>\n\n` +
                `<b>User:</b> ${txData.user_id}\n` +
                `<b>Amount:</b> ${parseFloat(Math.abs(txData.amount).toFixed(5))} GRAM`
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/withdrawals/delete', async (req, res) => {
    try {
        const { transactionId } = req.body;
        if (!transactionId) {
            return res.status(400).json({ success: false, error: 'Transaction ID required' });
        }
        const { error } = await supabase
            .from('withdrawals')
            .delete()
            .eq('id', transactionId);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/promo/create', async (req, res) => {
    try {
        const { code, reward, rewardType, maxUses, notifyChannels } = req.body;
        
        console.log('🔍 [promo/create] Creating promo:', { code, reward, rewardType, maxUses, notifyChannels });
        
        if (!code || !reward) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        if (!validateNumber(reward, 1)) {
            return res.status(400).json({ success: false, error: 'Invalid reward amount' });
        }
        if (!['power', 'gold'].includes(rewardType)) {
            return res.status(400).json({ success: false, error: 'Invalid reward type' });
        }
        
        const promoData = {
            code: code.toUpperCase(),
            reward_amount: parseInt(reward),
            reward_type: rewardType,
            max_uses: maxUses || 999999,
            total_uses: 0,
            created_at: Date.now()
        };
        
        const { data, error } = await supabase
            .from('promo_codes')
            .insert([promoData])
            .select();
        
        if (error) throw error;
        console.log('✅ [promo/create] Promo created in DB');
        
        let sent = 0;
        let failed = 0;
        let total = 0;
        let failedChannels = [];
        
        if (notifyChannels) {
            console.log('📢 [promo/create] Notifying channels...');
            const promotions = await getApprovedPromotions();
            total = promotions.length;
            
            for (const promo of promotions) {
                const channelId = promo.channel;
                const userLink = promo.link || `https://t.me/GramPirateBot/app?startapp=${promo.user_id}`;
                
                const result = await sendPromoToChannel(
                    channelId,
                    code,
                    reward,
                    rewardType,
                    maxUses || 999999,
                    userLink
                );
                
                if (result.success) {
                    sent++;
                } else {
                    failed++;
                    failedChannels.push({
                        channel: channelId,
                        user_id: promo.user_id,
                        error: result.error || 'Unknown error'
                    });
                }
            }
            
            let reportMessage = `<b>📢 Promo Code Sent to Channels</b>\n\n` +
                `<b>🔰 CODE:</b> <code>${code}</code>\n` +
                `<b>📊 Total Channels:</b> ${total}\n` +
                `<b>✅ Sent:</b> ${sent}\n` +
                `<b>❌ Failed:</b> ${failed}\n\n`;
            
            if (failedChannels.length > 0) {
                reportMessage += `<b>❌ Failed Channels:</b>\n`;
                failedChannels.forEach(fc => {
                    reportMessage += `• User ${fc.user_id}: ${fc.channel} - ${fc.error}\n`;
                });
            } else {
                reportMessage += `✅ All channels notified successfully!`;
            }
            
            await notifyAdmin(reportMessage);
            console.log(`📊 [promo/create] Report: Sent=${sent}, Failed=${failed}, Total=${total}`);
        }
        
        res.json({ 
            success: true, 
            data: data[0],
            sent,
            failed,
            total,
            failedChannels
        });
    } catch (error) {
        console.error('❌ [promo/create] Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


app.post('/api/admin/promo/list', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('promo_codes')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/promo/delete', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ success: false, error: 'Code required' });
        }
        const { error } = await supabase
            .from('promo_codes')
            .delete()
            .eq('code', code);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/promotions/list', async (req, res) => {
    try {
        const { status } = req.body;
        let query = supabase
            .from('users')
            .select('id, first_name, promotion')
            .not('promotion', 'is', null);
        
        if (status) {
            query = query.contains('promotion', { status: status });
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        const formattedData = data.map(u => ({
            user_id: u.id,
            first_name: u.first_name || 'User',
            channel: u.promotion?.channel || null,
            link: u.promotion?.link || null,
            status: u.promotion?.status || 'pending',
            submitted_at: u.promotion?.submitted_at || Date.now()
        }));
        
        res.json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/promotions/update', async (req, res) => {
    try {
        const { userId, status } = req.body;
        
        if (!validateUserId(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }
        
        const { data: userData, error: fetchError } = await supabase
            .from('users')
            .select('promotion, first_name')
            .eq('id', userId)
            .single();
        
        if (fetchError || !userData) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        if (!userData.promotion) {
            return res.status(404).json({ success: false, error: 'No promotion found for this user' });
        }
        
        const updatedPromotion = {
            ...userData.promotion,
            status: status,
            updated_at: Date.now()
        };
        
        const { error } = await supabase
            .from('users')
            .update({ promotion: updatedPromotion })
            .eq('id', userId);
        
        if (error) throw error;
        
        await notifyUser(userId,
            `<b>📢 Promotion Update</b>\n\n` +
            `<b>Status:</b> ${status.toUpperCase()}\n` +
            `<b>Channel:</b> ${userData.promotion.channel || 'N/A'}\n\n` +
            (status === 'approved' ? `✅ Your promotion has been approved! You now receive +25% earnings.` : 
             status === 'rejected' ? `❌ Your promotion request has been rejected. Please try again.` : 
             `⏳ Your promotion request is pending review.`)
        );
        
        await notifyAdmin(
            `<b>📢 Promotion ${status.toUpperCase()}</b>\n\n` +
            `<b>User:</b> ${userData.first_name || userId} (${userId})\n` +
            `<b>Channel:</b> ${userData.promotion.channel || 'N/A'}\n` +
            `<b>Link:</b> ${userData.promotion.link || 'N/A'}`
        );
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/promotions/delete', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!validateUserId(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }
        
        const { error } = await supabase
            .from('users')
            .update({ promotion: null })
            .eq('id', userId);
        
        if (error) throw error;
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/notifications/send', async (req, res) => {
    try {
        const { userId, message, buttons, target, photoUrl } = req.body;
        
        console.log('🔍 [notifications/send] Starting...', { target, userId, messageLength: message?.length });
        
        if (!BOT_TOKEN) {
            console.error('❌ [notifications/send] Bot token not configured');
            return res.status(400).json({ success: false, error: 'Bot not configured' });
        }
        if (!message) {
            console.error('❌ [notifications/send] Message is empty');
            return res.status(400).json({ success: false, error: 'Message required' });
        }
        
        let users = [];
        
        if (target === 'all') {
            console.log('📊 [notifications/send] Fetching all users...');
            let allUsers = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;
            
            while (hasMore) {
                const { data, error } = await supabase
                    .from('users')
                    .select('id')
                    .eq('state', 'active')
                    .range(page * pageSize, (page + 1) * pageSize - 1);
                
                if (error) {
                    console.error('❌ [notifications/send] Supabase error:', error.message);
                    throw error;
                }
                
                if (data && data.length > 0) {
                    allUsers = allUsers.concat(data);
                    page++;
                }
                
                if (!data || data.length < pageSize) {
                    hasMore = false;
                }
            }
            
            users = allUsers.map(u => u.id);
            console.log(`✅ [notifications/send] Found ${users.length} users`);
        } else if (target === 'single' && validateUserId(userId)) {
            users = [userId];
            console.log(`👤 [notifications/send] Single user: ${userId}`);
        } else {
            console.error('❌ [notifications/send] Invalid target');
            return res.status(400).json({ success: false, error: 'Invalid target' });
        }
        
        if (users.length === 0) {
            console.warn('⚠️ [notifications/send] No users found');
            return res.json({ success: true, sent: 0, failed: 0, total: 0 });
        }
        
        let sent = 0;
        let failed = 0;
        const batchSize = 30;
        const totalUsers = users.length;
        
        let replyMarkup = null;
        if (buttons && buttons.length > 0) {
            const keyboard = buttons.map(btn => ({
                text: btn.text,
                url: btn.url || undefined
            }));
            replyMarkup = {
                inline_keyboard: [keyboard]
            };
        }
        
        console.log(`📤 [notifications/send] Sending to ${totalUsers} users in batches of ${batchSize}...`);
        
        for (let i = 0; i < users.length; i += batchSize) {
            const batch = users.slice(i, i + batchSize);
            const promises = batch.map(async (uid) => {
                try {
                    let response;
                    const body = {
                        chat_id: uid,
                        text: message,
                        parse_mode: 'HTML'
                    };
                    
                    if (replyMarkup) {
                        body.reply_markup = replyMarkup;
                    }
                    
                    if (photoUrl) {
                        response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: uid,
                                photo: photoUrl,
                                caption: message,
                                parse_mode: 'HTML',
                                reply_markup: replyMarkup
                            })
                        });
                    } else {
                        response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                    }
                    
                    const data = await response.json();
                    if (data.ok) {
                        sent++;
                    } else {
                        failed++;
                        console.warn(`⚠️ [notifications/send] Failed for ${uid}:`, data.description);
                    }
                } catch (error) {
                    failed++;
                    console.error(`❌ [notifications/send] Error for ${uid}:`, error.message);
                }
            });
            
            await Promise.all(promises);
            
            if (totalUsers > 0) {
                const progress = Math.min(100, ((i + batchSize) / totalUsers) * 100);
                console.log(`📊 [notifications/send] Progress: ${Math.round(progress)}% (${Math.min(i + batchSize, totalUsers)}/${totalUsers})`);
            }
        }
        
        console.log(`✅ [notifications/send] Completed: Sent=${sent}, Failed=${failed}, Total=${totalUsers}`);
        
        await notifyAdmin(
            `<b>📨 Notification Sent</b>\n\n` +
            `<b>Target:</b> ${target}\n` +
            `<b>Total:</b> ${totalUsers}\n` +
            `<b>Sent:</b> ${sent}\n` +
            `<b>Failed:</b> ${failed}` +
            (buttons ? `\n<b>Buttons:</b> ${buttons.length}` : '') +
            (photoUrl ? `\n<b>Photo:</b> Yes` : '')
        );
        
        res.json({ success: true, sent, failed, total: totalUsers });
    } catch (error) {
        console.error('❌ [notifications/send] Fatal error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/topusers/list', async (req, res) => {
    try {
        const { type, limit } = req.body;
        const limitNum = Math.min(parseInt(limit) || 20, 100);
        
        const column = type === 'power' ? 'power_balance' : 'gold_balance';
        
        const { data, error } = await supabase
            .from('users')
            .select('id, first_name, photo_url, ' + column)
            .order(column, { ascending: false })
            .limit(limitNum);
        
        if (error) throw error;
        
        const formattedData = data.map(u => ({
            user_id: u.id,
            first_name: u.first_name || 'User',
            photo_url: u.photo_url || 'https://i.ibb.co/XxXhyZYf/file-000000006f8c720e9ab4c76b6e560062.png',
            value: type === 'power' ? (u.power_balance || 0) : parseFloat((u.gold_balance || 0).toFixed(5))
        }));
        
        res.json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'admin.html'));
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🏴‍☠️ PIRATE TEAM Admin Panel running on port ${PORT}`);
});
