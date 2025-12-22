// 模拟用户状态（不使用 localStorage）
let currentUser = null;
let points = 0;

const API_BASE = 'http://127.0.0.1:5000/api';
const AUTH_KEY = 'green_points_auth';

const RATE_BY_MODE = { bike: 3, walk: 3, bus: 1.5, metro: 1.5, ev: 1 };

// DOM 元素
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginTab = document.querySelector('.tab[data-tab="login"]');
const registerTab = document.querySelector('.tab[data-tab="register"]');
const switchToRegister = document.getElementById('switch-to-register');
const switchToLogin = document.getElementById('switch-to-login');
const totalPointsEl = document.getElementById('total-points');
const availablePointsEl = document.getElementById('available-points');
const pointsTable = document.getElementById('points-table');
const tripForm = document.getElementById('trip-form');

// 更新积分显示
function updatePointsDisplay() {
	totalPointsEl.textContent = points;
	availablePointsEl.textContent = points;
}

// 切换登录/注册表单
function switchTab(target) {
	if (target === 'login') {
		loginForm.style.display = 'block';
		registerForm.style.display = 'none';
		loginTab.classList.add('active');
		registerTab.classList.remove('active');
	} else {
		loginForm.style.display = 'none';
		registerForm.style.display = 'block';
		registerTab.classList.add('active');
		loginTab.classList.remove('active');
	}
}

// 登录提交
loginForm.addEventListener('submit', function (e) {
	e.preventDefault();
	const username = document.getElementById('login-username').value;
	const password = document.getElementById('login-password').value;
	apiLogin(username, password)
		.then(data => {
			const { token, user } = data;
			currentUser = { username: user.username };
			points = user.points;
			saveAuth(token, user.username, points);
			updatePointsDisplay();
			alert(`欢迎回来，${user.username}！`);
		})
		.catch(err => {
			alert(err.message || '登录失败');
		});
});

// 注册提交
registerForm.addEventListener('submit', function (e) {
	e.preventDefault();
	const username = document.getElementById('reg-username').value;
	const password = document.getElementById('reg-password').value;
	const phone = document.getElementById('reg-phone').value;

	apiRegister(username, password, phone)
		.then(data => {
			const { token, user } = data;
			currentUser = { username: user.username };
			points = user.points;
			saveAuth(token, user.username, points);
			alert(`注册成功！欢迎加入绿色出行大家庭，${user.username}！`);
			switchTab('login');
			updatePointsDisplay();
		})
		.catch(err => {
			alert(err.message || '注册失败');
		});
});

// 表单切换事件
loginTab.addEventListener('click', () => switchTab('login'));
registerTab.addEventListener('click', () => switchTab('register'));
switchToRegister.addEventListener('click', (e) => {
	e.preventDefault();
	switchTab('register');
});
switchToLogin.addEventListener('click', (e) => {
	e.preventDefault();
	switchTab('login');
});

// 行程上报（接入后端）
tripForm.addEventListener('submit', async function (e) {
	e.preventDefault();
	const auth = loadAuth();
	if (!auth || !auth.token) {
		alert('请先登录！');
		return;
	}

	const distance = parseFloat(document.getElementById('distance').value);
	const mode = document.getElementById('mode').value;
	const modeText = {
		bike: '骑行',
		walk: '步行',
		bus: '公交',
		metro: '地铁',
		ev: '新能源车'
	}[mode];

	try {
		const res = await fetch(`${API_BASE}/trips`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${auth.token}`
			},
			body: JSON.stringify({ distance, mode })
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || '行程上报失败');

		const earned = data.earned;
		points = data.user.points;
		saveAuth(auth.token, auth.username, points);
		updatePointsDisplay();

		const now = new Date();
		const dateStr = now.toISOString().split('T')[0];
		const row = document.createElement('tr');
		const td1 = document.createElement('td');
		const timeEl = document.createElement('time');
		timeEl.setAttribute('datetime', dateStr);
		timeEl.textContent = dateStr;
		td1.appendChild(timeEl);
		const td2 = document.createElement('td');
		td2.textContent = `${modeText} ${distance}km`;
		const td3 = document.createElement('td');
		td3.textContent = `+${earned}`;
		row.append(td1, td2, td3);
		pointsTable.prepend(row);

		alert(`行程上报成功！获得 ${earned} 积分 🌟`);
		tripForm.reset();
	} catch (err) {
		alert(err.message || '上报失败');
	}
});

// 兑换按钮（接入后端）
document.querySelectorAll('.redeem-btn').forEach(btn => {
	btn.addEventListener('click', async function () {
		const auth = loadAuth();
		if (!auth || !auth.token) {
			alert('请先登录！');
			return;
		}

		const productEl = this.closest('.product');
		const product = productEl.dataset.productName;
		const required = Number(productEl.dataset.requiredPoints);

		try {
			const res = await fetch(`${API_BASE}/redeem`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${auth.token}`
				},
				body: JSON.stringify({ productName: product, requiredPoints: required })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || '兑换失败');

			points = data.user.points;
			saveAuth(auth.token, auth.username, points);
			updatePointsDisplay();
			alert(`🎉 兑换成功！您已兑换【${product}】`);
		} catch (err) {
			alert(err.message || '兑换失败');
		}
	});
});

// 初始化
bootstrapAuth();

// ========== 后端接入与登录态持久化 ==========
function saveAuth(token, username, points) {
	const payload = { token, username, points };
	try { localStorage.setItem(AUTH_KEY, JSON.stringify(payload)); } catch { }
}

function loadAuth() {
	try {
		const raw = localStorage.getItem(AUTH_KEY);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch { return null; }
}

function clearAuth() {
	try { localStorage.removeItem(AUTH_KEY); } catch { }
}

async function apiLogin(username, password) {
	const res = await fetch(`${API_BASE}/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || '登录失败');
	return data;
}

async function apiRegister(username, password, phone) {
	const res = await fetch(`${API_BASE}/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password, phone })
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || '注册失败');
	return data;
}

async function apiMe(token) {
	const res = await fetch(`${API_BASE}/me`, {
		headers: { 'Authorization': `Bearer ${token}` }
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || '获取用户信息失败');
	return data;
}

function bootstrapAuth() {
	const auth = loadAuth();
	const userNameBadge = document.getElementById('user-name');
	const logoutBtn = document.getElementById('logout-btn');
	if (logoutBtn) {
		logoutBtn.addEventListener('click', async () => {
			const a = loadAuth();
			if (a && a.token) {
				try {
					await fetch(`${API_BASE}/logout`, {
						method: 'POST',
						headers: { 'Authorization': `Bearer ${a.token}` }
					});
				} catch { }
			}
			clearAuth();
			currentUser = null;
			points = 0; // 重置为默认值
			updatePointsDisplay();
			if (userNameBadge) userNameBadge.textContent = '未登录';
			alert('已退出登录');
		});
	}

	if (auth && auth.token && auth.username) {
		currentUser = { username: auth.username };
		points = typeof auth.points === 'number' ? auth.points : points;
		updatePointsDisplay();
		if (userNameBadge) userNameBadge.textContent = auth.username;
		// 尝试从后端同步最新积分
		apiMe(auth.token)
			.then(({ user }) => {
				points = user.points;
				updatePointsDisplay();
			})
			.catch(() => {
				// token 失效则清除本地态
				clearAuth();
				if (userNameBadge) userNameBadge.textContent = '未登录';
			});
	} else {
		updatePointsDisplay();
		if (userNameBadge) userNameBadge.textContent = '未登录';
	}
}
