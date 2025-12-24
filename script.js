let currentUser = null;
let points = 0;

const API_BASE = 'http://192.168.202.124:5000/api';
const AUTH_KEY = 'green_points_auth';

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
const pointsEmpty = document.getElementById('points-empty');
const tripForm = document.getElementById('trip-form');
const authSection = document.getElementById('auth-section');
const appShell = document.getElementById('app-shell');
const goodsGrid = document.getElementById('goods-grid');
const goodsEmpty = document.getElementById('goods-empty');
const userNameBadge = document.getElementById('user-name');
const navButtons = document.querySelectorAll('[data-nav-target]');
const pages = document.querySelectorAll('.page');

// 更新积分显示
function updatePointsDisplay() {
	if (totalPointsEl) totalPointsEl.textContent = points;
	if (availablePointsEl) availablePointsEl.textContent = points;
}

function showAuthScreen() {
	appShell.classList.add('hidden');
	authSection.classList.remove('hidden');
}

function showAppShell() {
	authSection.classList.add('hidden');
	appShell.classList.remove('hidden');
}

function setActivePage(target) {
	pages.forEach(page => {
		const active = page.dataset.page === target;
		page.classList.toggle('hidden', !active);
	});
	navButtons.forEach(btn => {
		const isTarget = btn.dataset.navTarget === target;
		btn.classList.toggle('active', isTarget);
	});
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

function onAuthSuccess(token, user) {
	currentUser = { username: user.username };
	points = user.points || 0;
	saveAuth(token, user.username, points);
	if (userNameBadge) userNameBadge.textContent = user.username;
	updatePointsDisplay();
	showAppShell();
	setActivePage('report');
	fetchPointsHistory();
	fetchGoods();
}

// 登录提交
loginForm.addEventListener('submit', function (e) {
	e.preventDefault();
	const username = document.getElementById('login-username').value.trim();
	const password = document.getElementById('login-password').value;
	apiLogin(username, password)
		.then(data => {
			alert(`欢迎回来，${data.user.username}！`);
			onAuthSuccess(data.token, data.user);
		})
		.catch(err => alert(err.message || '登录失败'));
});

// 注册提交
registerForm.addEventListener('submit', function (e) {
	e.preventDefault();
	const username = document.getElementById('reg-username').value.trim();
	const password = document.getElementById('reg-password').value;
	const phone = document.getElementById('reg-phone').value.trim();

	apiRegister(username, password, phone)
		.then(data => {
			alert(`注册成功！欢迎加入绿色出行大家庭，${data.user.username}！`);
			onAuthSuccess(data.token, data.user);
		})
		.catch(err => alert(err.message || '注册失败'));
});

// 表单切换事件
loginTab.addEventListener('click', () => switchTab('login'));
registerTab.addEventListener('click', () => switchTab('register'));
switchToRegister.addEventListener('click', (e) => { e.preventDefault(); switchTab('register'); });
switchToLogin.addEventListener('click', (e) => { e.preventDefault(); switchTab('login'); });

// 导航切换页面
navButtons.forEach(btn => {
	btn.addEventListener('click', () => {
		const target = btn.dataset.navTarget;
		if (!target) return;
		setActivePage(target);
	});
});

// 行程上报（接入后端）
tripForm.addEventListener('submit', async function (e) {
	e.preventDefault();
	const auth = loadAuth();
	if (!auth || !auth.token) {
		alert('请先登录！');
		showAuthScreen();
		return;
	}

	const distance = parseFloat(document.getElementById('distance').value);
	const mode = document.getElementById('mode').value;

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

		points = data.user.points;
		saveAuth(auth.token, auth.username, points);
		updatePointsDisplay();
		await fetchPointsHistory();
		alert(`行程上报成功！获得 ${data.earned} 积分 🌟`);
		tripForm.reset();
	} catch (err) {
		alert(err.message || '上报失败');
	}
});

// 商城兑换（事件委托，支持动态商品）
goodsGrid.addEventListener('click', async (e) => {
	const btn = e.target.closest('.redeem-btn');
	if (!btn) return;

	const auth = loadAuth();
	if (!auth || !auth.token) {
		alert('请先登录！');
		showAuthScreen();
		return;
	}

	const productEl = btn.closest('.product');
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
		await fetchPointsHistory();
		alert(`🎉 兑换成功！您已兑换【${product}】`);
	} catch (err) {
		alert(err.message || '兑换失败');
	}
});

async function fetchPointsHistory() {
	const auth = loadAuth();
	if (!auth || !auth.token) return;
	try {
		const res = await fetch(`${API_BASE}/points`, {
			headers: { 'Authorization': `Bearer ${auth.token}` }
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || '加载积分明细失败');
		points = data.user.points || 0;
		saveAuth(auth.token, auth.username, points);
		updatePointsDisplay();
		renderPointsTable(data.items || []);
	} catch (err) {
		console.warn(err);
	}
}

function renderPointsTable(items) {
	pointsTable.innerHTML = '';
	if (!items.length) {
		pointsEmpty.classList.remove('hidden');
		return;
	}
	pointsEmpty.classList.add('hidden');
	items.forEach(item => {
		const row = document.createElement('tr');
		const dateCell = document.createElement('td');
		const timeStr = item.date ? new Date(item.date).toLocaleString('zh-CN', { hour12: false }) : '-';
		dateCell.textContent = timeStr;
		const movementCell = document.createElement('td');
		movementCell.textContent = item.movement || '';
		const pointsCell = document.createElement('td');
		const val = Number(item.points || 0);
		pointsCell.textContent = val > 0 ? `+${val}` : val;
		row.append(dateCell, movementCell, pointsCell);
		pointsTable.appendChild(row);
	});
}

async function fetchGoods() {
	try {
		const res = await fetch(`${API_BASE}/goods`);
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || '加载商品失败');
		renderGoods(data.goods || []);
	} catch (err) {
		console.warn(err);
	}
}

function renderGoods(goods) {
	goodsGrid.innerHTML = '';
	if (!goods.length) {
		goodsEmpty.classList.remove('hidden');
		return;
	}
	goodsEmpty.classList.add('hidden');
	goods.forEach(item => {
		const card = document.createElement('div');
		card.className = 'product';
		card.dataset.productName = item.name;
		card.dataset.requiredPoints = item.value || 0;

		card.innerHTML = `
			<div class="product-img">🎁</div>
			<div class="product-info">
				<h4>${item.name}</h4>
				<p>库存：${item.stock ?? 0}</p>
				<div class="price">积分价值 ${item.value ?? 0}</div>
				<div class="points">需 ${item.value ?? 0} 积分</div>
				<button class="redeem-btn" ${item.stock <= 0 ? 'disabled' : ''}>${item.stock <= 0 ? '已售罄' : '立即兑换'}</button>
			</div>
		`;
		goodsGrid.appendChild(card);
	});
}

// ========== 后端接入与登录态持久化 ==========
function saveAuth(token, username, pointsValue) {
	const payload = { token, username, points: pointsValue };
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
			points = 0;
			updatePointsDisplay();
			if (userNameBadge) userNameBadge.textContent = '未登录';
			showAuthScreen();
			alert('已退出登录');
		});
	}

	if (auth && auth.token && auth.username) {
		currentUser = { username: auth.username };
		points = typeof auth.points === 'number' ? auth.points : points;
		updatePointsDisplay();
		if (userNameBadge) userNameBadge.textContent = auth.username;
		showAppShell();
		setActivePage('report');
		apiMe(auth.token)
			.then(({ user }) => {
				points = user.points;
				updatePointsDisplay();
				fetchPointsHistory();
				fetchGoods();
			})
			.catch(() => {
				clearAuth();
				if (userNameBadge) userNameBadge.textContent = '未登录';
				showAuthScreen();
			});
	} else {
		showAuthScreen();
	}
}

// 初始化
bootstrapAuth();
