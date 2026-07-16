/* ============================================================
 * 租屋管理系統 - 前端邏輯
 * 請將下方 API_URL 換成你部署 Apps Script 網頁應用程式後取得的網址
 * ============================================================ */
const API_URL = 'https://script.google.com/macros/s/AKfycbxMLnG2wmSewkJ6XwS5gMC4mhAJXd1VcWSSV5cdZmll1zlZFRlmRf9vnKjBADk76vQ/exec'; // 已自動填入你的部署網址
const LOCK_PASSWORD = '76751688';

let STATE = { rooms: [], bills: [], payments: [], expenses: [], settings: {} };

/* ---------------- 鎖定畫面 ---------------- */
(function initLock() {
  const unlocked = sessionStorage.getItem('unlocked') === '1';
  if (unlocked) {
    document.getElementById('lock-screen').style.display = 'none';
    boot();
  }
  document.getElementById('lock-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const val = document.getElementById('lock-input').value;
    if (val === LOCK_PASSWORD) {
      sessionStorage.setItem('unlocked', '1');
      document.getElementById('lock-screen').style.display = 'none';
      boot();
    } else {
      document.getElementById('lock-error').textContent = '密碼錯誤，請再試一次';
      document.getElementById('lock-input').value = '';
    }
  });
})();

/* ---------------- API 呼叫 ---------------- */
async function apiGet() {
  const res = await fetch(API_URL + '?action=getAll');
  return res.json();
}
async function apiPost(action, data) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, data })
  });
  return res.json();
}

/* ---------------- 共用小工具 ---------------- */
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function fmtMoney(n) { return '$' + Math.round(Number(n) || 0).toLocaleString(); }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(String(dateStr).slice(0, 10));
  const today = new Date(new Date().toDateString());
  return Math.round((target - today) / 86400000);
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
function openModal(title, innerHtml) {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet">
        <div class="modal-title">${title}<span class="close-x" id="modal-close">✕</span></div>
        ${innerHtml}
      </div>
    </div>`;
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('modal-backdrop').addEventListener('click', function (e) {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
}

/* ---------------- 開機：載入資料 ---------------- */
async function boot() {
  registerServiceWorker();
  await refreshData();
  initTabs();
  initDashboard();
  initRoomsTab();
  initMeterTab();
  initPaymentsTab();
  initReportsTab();
  renderAll();
}

async function refreshData() {
  try {
    const data = await apiGet();
    if (!data.ok) throw new Error(data.error);
    STATE = data;
  } catch (err) {
    toast('讀取資料失敗，請檢查網路或 API 設定');
    console.error(err);
  }
}

function renderAll() {
  renderDashboard();
  renderRooms();
  renderMeterRoomOptions();
  renderMeterRecentBills();
  renderPayments();
  renderReports();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

/* ---------------- 分頁切換 ---------------- */
function initTabs() {
  const titles = {
    dashboard: ['總覽', '房東儀表板'],
    rooms: ['房客 / 合約', '共 ' + STATE.rooms.length + ' 間套房'],
    meter: ['抄表 / 電租帳單', '一鍵複製到 LINE'],
    payments: ['未分類收款', '銀行自動入帳偵測'],
    reports: ['收支報表', '月度 / 年度統計']
  };
  document.querySelectorAll('nav.tabbar button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('nav.tabbar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const name = btn.dataset.screen;
      document.getElementById('screen-' + name).classList.add('active');
      const t = titles[name];
      document.getElementById('topbar-title').textContent = t[0];
      document.getElementById('topbar-subtitle').textContent = t[1];
    });
  });
}

/* ============================================================
 * 總覽 Dashboard
 * ============================================================ */
function initDashboard() {}

function renderDashboard() {
  const rooms = STATE.rooms || [];
  const bills = STATE.bills || [];
  const payments = STATE.payments || [];

  // 合約到期預警（少於 30 天）
  const expiring = rooms
    .map(r => ({ room: r, days: daysUntil(r.ContractEnd) }))
    .filter(x => x.days !== null && x.days < 30);

  const alertsEl = document.getElementById('dash-alerts');
  if (expiring.length === 0) {
    alertsEl.innerHTML = '';
  } else {
    alertsEl.innerHTML = expiring.sort((a, b) => a.days - b.days).map(x => `
      <div class="alert-banner">
        <div class="icon">⚠️</div>
        <div>
          <div class="title">${x.room.RoomNo} 房合約即將到期</div>
          <div class="desc">
            ${x.days < 0 ? `已到期 ${Math.abs(x.days)} 天` : `剩下 ${x.days} 天`}
            （${x.room.ContractEnd}）－請確認續約或調漲租金
          </div>
        </div>
      </div>`).join('');
  }

  const pendingBills = bills.filter(b => b.Status === '待繳');
  document.getElementById('stat-pending-bills').textContent = pendingBills.length;
  document.getElementById('stat-unclassified').textContent =
    payments.filter(p => p.Status === '未分類').length;
  document.getElementById('stat-expiring').textContent = expiring.length;

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthIncome = bills
    .filter(b => b.Status === '已繳' && b.PaidAt && String(b.PaidAt).slice(0, 7) === thisMonth)
    .reduce((s, b) => s + Number(b.Amount), 0);
  document.getElementById('stat-month-income').textContent = fmtMoney(monthIncome);

  const listEl = document.getElementById('dash-pending-bills');
  if (pendingBills.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="icon">✅</div><div class="msg">目前沒有待繳帳單</div></div>`;
  } else {
    listEl.innerHTML = pendingBills.map(b => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;">${b.RoomNo} 房 · ${b.Type}</div>
            <div class="hint">${b.PeriodLabel}</div>
          </div>
          <div class="num" style="font-weight:800;font-size:16px;">${fmtMoney(b.Amount)}</div>
        </div>
      </div>`).join('');
  }
}

/* ============================================================
 * 房客 / 合約
 * ============================================================ */
function initRoomsTab() {
  document.getElementById('fab-add-room').addEventListener('click', () => openRoomForm(null));
}

function renderRooms() {
  const rooms = (STATE.rooms || []).slice().sort((a, b) => String(a.RoomNo).localeCompare(String(b.RoomNo)));
  const el = document.getElementById('rooms-list');
  if (rooms.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="icon">🛏️</div><div class="msg">尚未新增房間，點右下角 ＋ 開始建立</div></div>`;
    return;
  }
  el.innerHTML = rooms.map(r => {
    const days = daysUntil(r.ContractEnd);
    let badge = '';
    if (days !== null && days < 30) {
      badge = `<span class="badge warn">⚠ ${days < 0 ? '已到期' : days + ' 天後到期'}</span>`;
    }
    return `
      <div class="card room-card" data-room="${r.RoomNo}">
        <div class="room-head">
          <div class="room-no">${r.RoomNo} 房</div>
          ${badge}
        </div>
        <div class="tenant">👤 ${r.TenantName || '（空房）'} ${r.Phone ? ' · ' + r.Phone : ''}</div>
        <div class="rent-line">💰 每月 $${r.RentAmount || 0}（${r.RentCycle || ''}）　押金 $${r.Deposit || 0}</div>
        <div class="meta-row">
          <span>合約：${r.ContractStart || '-'} ~ ${r.ContractEnd || '-'}</span>
        </div>
        <div class="meta-row">
          <span>房租已繳至：<strong>${r.NextRentDueDate || '尚未設定'}</strong></span>
        </div>
        <div class="btn-row">
          <button class="btn btn-outline btn-sm" data-action="edit">編輯</button>
          <button class="btn btn-outline btn-sm" data-action="rentbill">產生租金帳單</button>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.room-card').forEach(card => {
    const roomNo = card.dataset.room;
    card.querySelector('[data-action="edit"]').addEventListener('click', () => {
      const room = STATE.rooms.find(r => String(r.RoomNo) === String(roomNo));
      openRoomForm(room);
    });
    card.querySelector('[data-action="rentbill"]').addEventListener('click', () => {
      const room = STATE.rooms.find(r => String(r.RoomNo) === String(roomNo));
      openGenerateRentBillModal(room);
    });
  });
}

function openGenerateRentBillModal(room) {
  const cycleDefault = room.RentCycle === '雙月繳' ? 2 : (room.RentCycle === '季繳' ? 3 : 1);
  openModal(`產生租金帳單 · ${room.RoomNo} 房`, `
    <div class="hint" style="margin-bottom:10px;">房租已繳至：<strong>${room.NextRentDueDate || '尚未設定'}</strong>，請輸入這次要收幾個月的租金</div>
    <div class="field">
      <label>這次要收幾個月</label>
      <input id="rb-months" type="number" min="1" value="${cycleDefault}">
    </div>
    <div class="hint" id="rb-preview"></div>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-primary" id="btn-confirm-rentbill">產生帳單</button>
    </div>
  `);
  const updatePreview = () => {
    const months = Number(document.getElementById('rb-months').value || 1);
    const amount = Number(room.RentAmount) * months;
    document.getElementById('rb-preview').textContent = `本次金額：每月 $${room.RentAmount} × ${months} 個月 = $${amount}`;
  };
  document.getElementById('rb-months').addEventListener('input', updatePreview);
  updatePreview();

  document.getElementById('btn-confirm-rentbill').addEventListener('click', async () => {
    const months = Number(document.getElementById('rb-months').value || 1);
    const res = await apiPost('generateRentBill', { roomNo: room.RoomNo, months });
    if (res.ok) { toast('已產生租金待繳帳單'); closeModal(); await refreshData(); renderAll(); }
    else toast('失敗：' + res.error);
  });
}

function openRoomForm(room) {
  const isEdit = !!room;
  const r = room || {};
  openModal(isEdit ? `編輯 ${r.RoomNo} 房` : '新增房間', `
    <div class="field"><label>房號</label><input id="f-roomNo" value="${r.RoomNo || ''}" ${isEdit ? 'disabled' : ''} placeholder="例如 101"></div>
    <div class="field-row">
      <div class="field"><label>房客姓名</label><input id="f-tenantName" value="${r.TenantName || ''}"></div>
      <div class="field"><label>聯絡電話</label><input id="f-phone" value="${r.Phone || ''}"></div>
    </div>
    <div class="field"><label>押金金額</label><input id="f-deposit" type="number" value="${r.Deposit || ''}"></div>
    <div class="field-row">
      <div class="field"><label>合約開始日期</label><input id="f-contractStart" type="date" value="${r.ContractStart ? String(r.ContractStart).slice(0, 10) : ''}"></div>
      <div class="field"><label>合約結束日期</label><input id="f-contractEnd" type="date" value="${r.ContractEnd ? String(r.ContractEnd).slice(0, 10) : ''}"></div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>租金週期（僅作為預設收款月數參考）</label>
        <select id="f-rentCycle">
          <option ${r.RentCycle === '月繳' ? 'selected' : ''}>月繳</option>
          <option ${r.RentCycle === '雙月繳' ? 'selected' : ''}>雙月繳</option>
          <option ${r.RentCycle === '季繳' ? 'selected' : ''}>季繳</option>
        </select>
      </div>
      <div class="field"><label>每月租金金額</label><input id="f-rentAmount" type="number" value="${r.RentAmount || ''}"></div>
    </div>
    <div class="field">
      <label>房租已繳至</label>
      <input id="f-paidThrough" type="date" value="${r.NextRentDueDate ? String(r.NextRentDueDate).slice(0, 10) : (r.ContractStart ? String(r.ContractStart).slice(0, 10) : '')}">
      <div class="hint">請填目前實際已經收到租金的最後一天，之後系統會依照你「產生租金帳單」時輸入的月數自動往後推進，不用擔心跟合約起始日對不齊</div>
    </div>
    <div class="field">
      <label>${isEdit ? '目前電表讀數（可手動校正）' : '起始電表讀數'}</label>
      <input id="f-lastMeterReading" type="number" value="${r.LastMeterReading || ''}" placeholder="例如 1234（入住當天抄表的數字）">
      <div class="hint">${isEdit ? '如果之後要校正電表數字，可直接改這裡（不會產生帳單）' : '請填入房客入住當天，你自己抄下的電表讀數，之後第一次計費才會算得準'}</div>
    </div>
    <div class="field"><label>備註</label><textarea id="f-note">${r.Note || ''}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btn-save-room">儲存</button>
      ${isEdit ? '<button class="btn btn-danger" id="btn-del-room">刪除房間</button>' : ''}
    </div>
  `);

  document.getElementById('btn-save-room').addEventListener('click', async () => {
    const data = {
      roomNo: document.getElementById('f-roomNo').value.trim(),
      tenantName: document.getElementById('f-tenantName').value.trim(),
      phone: document.getElementById('f-phone').value.trim(),
      deposit: Number(document.getElementById('f-deposit').value || 0),
      contractStart: document.getElementById('f-contractStart').value,
      contractEnd: document.getElementById('f-contractEnd').value,
      rentCycle: document.getElementById('f-rentCycle').value,
      rentAmount: Number(document.getElementById('f-rentAmount').value || 0),
      lastMeterReading: Number(document.getElementById('f-lastMeterReading').value || 0),
      nextRentDueDate: document.getElementById('f-paidThrough').value,
      note: document.getElementById('f-note').value.trim()
    };
    if (!data.roomNo) { toast('請輸入房號'); return; }
    const res = isEdit ? await apiPost('updateRoom', data) : await apiPost('addRoom', data);
    if (res.ok) { toast('已儲存'); closeModal(); await refreshData(); renderAll(); }
    else toast('失敗：' + res.error);
  });

  if (isEdit) {
    document.getElementById('btn-del-room').addEventListener('click', async () => {
      if (!confirm(`確定要刪除 ${r.RoomNo} 房嗎？`)) return;
      const res = await apiPost('deleteRoom', { roomNo: r.RoomNo });
      if (res.ok) { toast('已刪除'); closeModal(); await refreshData(); renderAll(); }
      else toast('失敗：' + res.error);
    });
  }
}

/* ============================================================
 * 抄表 / 電租合一帳單
 * ============================================================ */
function initMeterTab() {
  document.getElementById('meter-room-select').addEventListener('change', updateMeterLastReading);
  document.getElementById('btn-calc-bill').addEventListener('click', calcAndGenerateBill);
}

function renderMeterRoomOptions() {
  const sel = document.getElementById('meter-room-select');
  const rooms = (STATE.rooms || []).slice().sort((a, b) => String(a.RoomNo).localeCompare(String(b.RoomNo)));
  sel.innerHTML = rooms.map(r => `<option value="${r.RoomNo}">${r.RoomNo} 房 - ${r.TenantName || '空房'}</option>`).join('');
  updateMeterLastReading();
  const price = STATE.settings ? STATE.settings.ElecUnitPrice : 5.5;
  document.getElementById('meter-price-hint').textContent = `目前電費單價：每度 $${price}（可於「報表」分頁修改）`;
}

function updateMeterLastReading() {
  const roomNo = document.getElementById('meter-room-select').value;
  const room = (STATE.rooms || []).find(r => String(r.RoomNo) === String(roomNo));
  document.getElementById('meter-last').value = room ? (room.LastMeterReading || 0) : '';
}

async function calcAndGenerateBill() {
  const roomNo = document.getElementById('meter-room-select').value;
  const newReading = document.getElementById('meter-new').value;
  if (!roomNo) { toast('請先新增房間'); return; }
  if (!newReading) { toast('請輸入本次電表數字'); return; }

  const res = await apiPost('recordMeterAndBill', { roomNo, newReading });
  if (!res.ok) { toast('失敗：' + res.error); return; }

  const r = res.result;
  document.getElementById('meter-result').innerHTML = `
    <div class="bill-ticket">
      <div class="ticket-title">📋 帳單已產生（${roomNo} 房）</div>
      <pre id="bill-text-content">${r.billText}</pre>
      <button class="btn btn-primary" id="btn-copy-bill" style="margin-top:12px;">📋 一鍵複製到 LINE</button>
    </div>`;
  document.getElementById('btn-copy-bill').addEventListener('click', () => copyBillText(r.billText));

  document.getElementById('meter-new').value = '';
  await refreshData();
  renderAll();
}

function copyBillText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('已複製！請貼到 LINE 聊天室'))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('已複製！請貼到 LINE 聊天室'); }
  catch (e) { toast('複製失敗，請手動選取文字'); }
  document.body.removeChild(ta);
}

function renderMeterRecentBills() {
  const bills = (STATE.bills || [])
    .slice()
    .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt))
    .slice(0, 15);
  const el = document.getElementById('meter-recent-bills');
  if (bills.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="icon">⚡</div><div class="msg">尚無帳單紀錄</div></div>`;
    return;
  }
  el.innerHTML = bills.map(b => {
    const statusBadge = b.Status === '待繳'
      ? '<span class="badge warn">待繳</span>'
      : (String(b.Status).indexOf('已合併') === 0
        ? '<span class="badge neutral">已合併</span>'
        : '<span class="badge success">已繳</span>');
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;">${b.RoomNo} 房 · ${b.Type}</div>
            <div class="hint">${b.PeriodLabel}</div>
          </div>
          <div style="text-align:right;">
            <div class="num" style="font-weight:800;">${fmtMoney(b.Amount)}</div>
            ${statusBadge}
          </div>
        </div>
        <div class="btn-row">
          ${b.Status === '待繳' ? `<button class="btn btn-outline btn-sm mark-paid" data-id="${b.BillID}">標記為已繳</button>` : ''}
          <button class="btn btn-outline btn-sm edit-bill" data-id="${b.BillID}">編輯</button>
          <button class="btn btn-danger btn-sm delete-bill" data-id="${b.BillID}">刪除</button>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.mark-paid').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await apiPost('markBillPaid', { billId: btn.dataset.id });
      if (res.ok) { toast('已標記為已繳'); await refreshData(); renderAll(); }
      else toast('失敗：' + res.error);
    });
  });
  el.querySelectorAll('.edit-bill').forEach(btn => {
    btn.addEventListener('click', () => openBillEditModal(btn.dataset.id));
  });
  el.querySelectorAll('.delete-bill').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定要刪除這筆帳單嗎？此動作無法復原。')) return;
      const res = await apiPost('deleteBill', { billId: btn.dataset.id });
      if (res.ok) { toast('已刪除帳單'); await refreshData(); renderAll(); }
      else toast('失敗：' + res.error);
    });
  });
}

function openBillEditModal(billId) {
  const bill = (STATE.bills || []).find(b => b.BillID === billId);
  if (!bill) { toast('找不到這筆帳單'); return; }
  openModal(`編輯帳單（${bill.RoomNo} 房）`, `
    <div class="field"><label>期別標籤</label><input id="eb-period" value="${bill.PeriodLabel || ''}"></div>
    <div class="field"><label>明細內容</label><textarea id="eb-detail">${bill.DetailText || ''}</textarea></div>
    <div class="field"><label>金額</label><input id="eb-amount" type="number" value="${bill.Amount || ''}"></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btn-save-bill">儲存</button>
    </div>
  `);
  document.getElementById('btn-save-bill').addEventListener('click', async () => {
    const data = {
      billId: billId,
      periodLabel: document.getElementById('eb-period').value.trim(),
      detailText: document.getElementById('eb-detail').value,
      amount: Number(document.getElementById('eb-amount').value || 0)
    };
    const res = await apiPost('updateBill', data);
    if (res.ok) { toast('已儲存'); closeModal(); await refreshData(); renderAll(); }
    else toast('失敗：' + res.error);
  });
}

/* ============================================================
 * 未分類收款
 * ============================================================ */
function initPaymentsTab() {}

function renderPayments() {
  const payments = (STATE.payments || [])
    .filter(p => p.Status === '未分類')
    .sort((a, b) => new Date(b.ReceivedTime) - new Date(a.ReceivedTime));
  const el = document.getElementById('payments-list');
  if (payments.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="icon">💰</div><div class="msg">目前沒有未分類的收款</div></div>`;
    return;
  }
  el.innerHTML = payments.map(p => `
    <div class="card">
      <div class="payment-card">
        <div>
          <div class="amount num">${fmtMoney(p.Amount)}</div>
          <div class="time">${p.ReceivedTime ? new Date(p.ReceivedTime).toLocaleString('zh-TW') : ''}</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" data-action="assign" data-id="${p.PaymentID}">指派帳單</button>
        <button class="btn btn-outline btn-sm" data-action="edit" data-id="${p.PaymentID}">編輯金額</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${p.PaymentID}">刪除</button>
      </div>
    </div>`).join('');

  el.querySelectorAll('[data-action="assign"]').forEach(btn => {
    btn.addEventListener('click', () => openAssignPaymentModal(btn.dataset.id));
  });
  el.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openEditPaymentModal(btn.dataset.id));
  });
  el.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定要刪除這筆收款紀錄嗎？')) return;
      const res = await apiPost('deletePayment', { paymentId: btn.dataset.id });
      if (res.ok) { toast('已刪除'); await refreshData(); renderAll(); }
      else toast('失敗：' + res.error);
    });
  });
}

function openEditPaymentModal(paymentId) {
  const payment = STATE.payments.find(p => p.PaymentID === paymentId);
  if (!payment) { toast('找不到這筆收款紀錄'); return; }
  openModal('編輯收款金額', `
    <div class="field"><label>金額</label><input id="ep-amount" type="number" value="${payment.Amount || ''}"></div>
    <div class="hint">原始擷取內容：${payment.RawText || '（無）'}</div>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-primary" id="btn-save-payment">儲存</button>
    </div>
  `);
  document.getElementById('btn-save-payment').addEventListener('click', async () => {
    const amount = Number(document.getElementById('ep-amount').value || 0);
    const res = await apiPost('updatePayment', { paymentId, amount });
    if (res.ok) { toast('已儲存'); closeModal(); await refreshData(); renderAll(); }
    else toast('失敗：' + res.error);
  });
}

function openAssignPaymentModal(paymentId) {
  const payment = STATE.payments.find(p => p.PaymentID === paymentId);
  let pendingBills = (STATE.bills || []).filter(b => b.Status === '待繳');
  if (pendingBills.length === 0) {
    openModal('指派收款', `<div class="empty-state"><div class="icon">📭</div><div class="msg">目前沒有待繳帳單可供指派</div></div>`);
    return;
  }

  // 金額剛好對得上的排最前面，方便一眼找到最可能的那筆
  pendingBills = pendingBills.slice().sort((a, b) => {
    const aMatch = Number(a.Amount) === Number(payment.Amount) ? 0 : 1;
    const bMatch = Number(b.Amount) === Number(payment.Amount) ? 0 : 1;
    return aMatch - bMatch;
  });

  openModal(`指派收款 ${fmtMoney(payment.Amount)}`, `
    <div class="field">
      <label>選擇要核銷的帳單（金額相符的排最上面）</label>
      <div id="assign-bill-list">
        ${pendingBills.map((b, i) => {
          const isMatch = Number(b.Amount) === Number(payment.Amount);
          return `
          <label class="card" style="display:flex;align-items:center;gap:10px;cursor:pointer;${isMatch ? 'border-color:var(--primary);' : ''}">
            <input type="radio" name="assign-bill" value="${b.BillID}" ${i === 0 ? 'checked' : ''} style="width:18px;height:18px;flex-shrink:0;">
            <div style="flex:1;">
              <div style="font-weight:700;">${b.RoomNo} 房 · ${b.Type} ${isMatch ? '<span class="badge success">✓ 金額相符</span>' : ''}</div>
              <div class="hint">${b.PeriodLabel}</div>
            </div>
            <div class="num" style="font-weight:800;">${fmtMoney(b.Amount)}</div>
          </label>`;
        }).join('')}
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btn-confirm-assign">確認核銷</button>
      <button class="btn btn-ghost" id="btn-ignore-payment">忽略此筆</button>
    </div>
  `);
  document.getElementById('btn-confirm-assign').addEventListener('click', async () => {
    const selected = document.querySelector('input[name="assign-bill"]:checked');
    if (!selected) { toast('請先選擇一筆帳單'); return; }
    const res = await apiPost('assignPayment', { paymentId, billId: selected.value });
    if (res.ok) { toast('已核銷完成'); closeModal(); await refreshData(); renderAll(); }
    else toast('失敗：' + res.error);
  });
  document.getElementById('btn-ignore-payment').addEventListener('click', async () => {
    const res = await apiPost('ignorePayment', { paymentId });
    if (res.ok) { toast('已忽略'); closeModal(); await refreshData(); renderAll(); }
    else toast('失敗：' + res.error);
  });
}

/* ============================================================
 * 報表
 * ============================================================ */
function initReportsTab() {
  const now = new Date();
  document.getElementById('report-month').value = now.toISOString().slice(0, 7);
  document.getElementById('report-year').value = now.getFullYear();
  document.getElementById('report-month').addEventListener('change', renderReports);
  document.getElementById('report-year').addEventListener('change', renderReports);
  document.getElementById('btn-add-expense').addEventListener('click', () => openExpenseForm());
  document.getElementById('btn-save-price').addEventListener('click', async () => {
    const val = document.getElementById('setting-elec-price').value;
    const res = await apiPost('updateSetting', { key: 'ElecUnitPrice', value: Number(val) });
    if (res.ok) { toast('電費單價已更新'); await refreshData(); renderAll(); }
  });
}

function renderReports() {
  const bills = STATE.bills || [];
  const expenses = STATE.expenses || [];
  document.getElementById('setting-elec-price').value = STATE.settings ? STATE.settings.ElecUnitPrice : 5.5;

  const month = document.getElementById('report-month').value; // yyyy-mm
  const monthIncome = bills
    .filter(b => b.Status === '已繳' && b.PaidAt && String(b.PaidAt).slice(0, 7) === month)
    .reduce((s, b) => s + Number(b.Amount), 0);
  const monthExpense = expenses
    .filter(e => e.Date && String(e.Date).slice(0, 7) === month)
    .reduce((s, e) => s + Number(e.Amount), 0);
  document.getElementById('report-income').textContent = fmtMoney(monthIncome);
  document.getElementById('report-expense').textContent = fmtMoney(monthExpense);
  document.getElementById('report-profit').textContent = fmtMoney(monthIncome - monthExpense);

  const year = document.getElementById('report-year').value;
  const yearIncome = bills
    .filter(b => b.Status === '已繳' && b.PaidAt && String(b.PaidAt).slice(0, 4) === String(year))
    .reduce((s, b) => s + Number(b.Amount), 0);
  const yearExpense = expenses
    .filter(e => e.Date && String(e.Date).slice(0, 4) === String(year))
    .reduce((s, e) => s + Number(e.Amount), 0);
  document.getElementById('year-income').textContent = fmtMoney(yearIncome);
  document.getElementById('year-expense').textContent = fmtMoney(yearExpense);
  document.getElementById('year-profit').textContent = fmtMoney(yearIncome - yearExpense);

  const expEl = document.getElementById('expense-list');
  const recentExpenses = expenses.slice().sort((a, b) => new Date(b.Date) - new Date(a.Date)).slice(0, 20);
  if (recentExpenses.length === 0) {
    expEl.innerHTML = `<div class="empty-state"><div class="icon">🧾</div><div class="msg">尚無支出紀錄</div></div>`;
  } else {
    expEl.innerHTML = `<div class="card">` + recentExpenses.map(e => `
      <div class="expense-row" data-id="${e.ExpenseID}">
        <span>${e.Date} · ${e.Category}${e.Note ? '（' + e.Note + '）' : ''}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span class="num">-${fmtMoney(e.Amount)}</span>
          <button class="btn-ghost edit-expense" data-id="${e.ExpenseID}" style="padding:2px 4px;width:auto;font-size:13px;">✏️</button>
          <button class="btn-ghost delete-expense" data-id="${e.ExpenseID}" style="padding:2px 4px;width:auto;font-size:13px;color:var(--danger);">🗑️</button>
        </span>
      </div>`).join('') + `</div>`;

    expEl.querySelectorAll('.edit-expense').forEach(btn => {
      btn.addEventListener('click', () => openExpenseForm(btn.dataset.id));
    });
    expEl.querySelectorAll('.delete-expense').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('確定要刪除這筆支出嗎？')) return;
        const res = await apiPost('deleteExpense', { expenseId: btn.dataset.id });
        if (res.ok) { toast('已刪除'); await refreshData(); renderAll(); }
        else toast('失敗：' + res.error);
      });
    });
  }
}

function openExpenseForm(expenseId) {
  const isEdit = !!expenseId;
  const ex = isEdit ? (STATE.expenses || []).find(e => e.ExpenseID === expenseId) : null;
  openModal(isEdit ? '編輯支出' : '新增支出', `
    <div class="field"><label>日期</label><input id="ex-date" type="date" value="${ex ? String(ex.Date).slice(0, 10) : new Date().toISOString().slice(0, 10)}"></div>
    <div class="field">
      <label>分類</label>
      <select id="ex-category">
        ${['廣告刊登', '維修保養', '清潔耗材', '稅金規費', '其他雜項'].map(c =>
          `<option ${ex && ex.Category === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>金額</label><input id="ex-amount" type="number" value="${ex ? ex.Amount : ''}"></div>
    <div class="field"><label>備註</label><textarea id="ex-note" placeholder="例如：591 廣告、冷氣維修、買燈泡">${ex ? ex.Note || '' : ''}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btn-save-expense">儲存</button>
      ${isEdit ? '<button class="btn btn-danger" id="btn-del-expense">刪除</button>' : ''}
    </div>
  `);
  document.getElementById('btn-save-expense').addEventListener('click', async () => {
    const data = {
      date: document.getElementById('ex-date').value,
      category: document.getElementById('ex-category').value,
      amount: Number(document.getElementById('ex-amount').value || 0),
      note: document.getElementById('ex-note').value.trim()
    };
    if (!data.amount) { toast('請輸入金額'); return; }
    const res = isEdit
      ? await apiPost('updateExpense', { ...data, expenseId })
      : await apiPost('addExpense', data);
    if (res.ok) { toast('已儲存'); closeModal(); await refreshData(); renderAll(); }
    else toast('失敗：' + res.error);
  });
  if (isEdit) {
    document.getElementById('btn-del-expense').addEventListener('click', async () => {
      if (!confirm('確定要刪除這筆支出嗎？')) return;
      const res = await apiPost('deleteExpense', { expenseId });
      if (res.ok) { toast('已刪除'); closeModal(); await refreshData(); renderAll(); }
      else toast('失敗：' + res.error);
    });
  }
}
