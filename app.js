/* ============================================================
 * 租屋管理系統 - 前端邏輯
 * 請將下方 API_URL 換成你部署 Apps Script 網頁應用程式後取得的網址
 * ============================================================ */
const API_URL = 'https://script.google.com/macros/s/AKfycbxMLnG2wmSewkJ6XwS5gMC4mhAJXd1VcWSSV5cdZmll1zlZFRlmRf9vnKjBADk76vQ/exec'; // 已自動填入你的部署網址
const LOCK_PASSWORD = '76751688';

let STATE = { rooms: [], bills: [], payments: [], expenses: [], settings: {} };

/* ---------------- 全域上一步／下一步（復原／重做）系統 ---------------- */
const HISTORY_LIMIT = 30;
let historyUndoStack = [];
let historyRedoStack = [];

/**
 * 每個會修改資料的動作完成後，呼叫這個函式登記一筆歷史紀錄：
 * label：顯示用的簡短說明
 * undo：復原這個動作要做的事（async function）
 * redo：重新套用這個動作要做的事（async function）
 */
function pushHistory(entry) {
  historyUndoStack.push(entry);
  if (historyUndoStack.length > HISTORY_LIMIT) historyUndoStack.shift();
  historyRedoStack = []; // 有新動作發生，重做的紀錄就失效了（跟瀏覽器上一頁/下一頁邏輯一樣）
  updateHistoryButtons();
}

async function historyUndo() {
  if (historyUndoStack.length === 0) return;
  const entry = historyUndoStack.pop();
  updateHistoryButtons();
  try {
    await entry.undo();
    historyRedoStack.push(entry);
    toast('↩️ 已復原：' + entry.label);
  } catch (err) {
    toast('復原失敗：' + err.message);
  }
  await refreshData();
  renderAll();
  updateHistoryButtons();
}

async function historyRedo() {
  if (historyRedoStack.length === 0) return;
  const entry = historyRedoStack.pop();
  updateHistoryButtons();
  try {
    await entry.redo();
    historyUndoStack.push(entry);
    toast('↪️ 已重做：' + entry.label);
  } catch (err) {
    toast('重做失敗：' + err.message);
  }
  await refreshData();
  renderAll();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const undoBtn = document.getElementById('global-undo-btn');
  const redoBtn = document.getElementById('global-redo-btn');
  if (undoBtn) undoBtn.disabled = historyUndoStack.length === 0;
  if (redoBtn) redoBtn.disabled = historyRedoStack.length === 0;
}

/**
 * 防止重複點擊：按鈕點下去之後立刻鎖住，直到這個非同步動作完成才解鎖，
 * 避免因為網路慢、使用者手滑連點，導致同一個操作被送出兩次（例如帳單重複產生）。
 */
async function runLocked(button, asyncFn) {
  if (!button || button.dataset.busy === '1') return;
  button.dataset.busy = '1';
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = '處理中…';
  try {
    await asyncFn();
  } finally {
    button.dataset.busy = '';
    button.disabled = false;
    button.textContent = originalText;
  }
}

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
  const parts = String(dateStr).slice(0, 10).split('-').map(Number);
  const targetUTC = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((targetUTC - todayUTC) / 86400000);
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
  document.getElementById('global-undo-btn').addEventListener('click', historyUndo);
  document.getElementById('global-redo-btn').addEventListener('click', historyRedo);
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
  renderBatchMeterTable();
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

  // 合約到期預警（少於 3 個月）
  const expiring = rooms
    .map(r => ({ room: r, days: daysUntil(r.ContractEnd) }))
    .filter(x => x.days !== null && x.days < 90);

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
  document.getElementById('btn-monthly-rent-overview').addEventListener('click', openMonthlyRentOverviewModal);
}

function openMonthlyRentOverviewModal() {
  const rooms = (STATE.rooms || []).slice().sort((a, b) => String(a.RoomNo).localeCompare(String(b.RoomNo)));
  if (rooms.length === 0) {
    openModal('本月租金總覽', `<div class="empty-state"><div class="icon">🛏️</div><div class="msg">尚未新增房間</div></div>`);
    return;
  }
  openModal('本月租金總覽', `
    <div class="hint" style="margin-bottom:10px;">預設全部勾選，不需要這次收租的房間，取消勾選就好；月數可依實際情況調整（合約 30 天內到期的房間會預設不勾，視為即將退租）</div>
    <div id="rent-overview-list">
      ${rooms.map(r => {
        const cycleDefault = r.RentCycle === '雙月繳' ? 2 : (r.RentCycle === '季繳' ? 3 : 1);
        const contractDays = daysUntil(r.ContractEnd);
        const isExpiringSoon = contractDays !== null && contractDays < 30;
        return `
        <label class="card" style="display:block;cursor:pointer;${isExpiringSoon ? 'border-color:var(--danger);' : ''}">
          <div style="display:flex;align-items:center;gap:10px;">
            <input type="checkbox" class="rent-overview-check" data-room="${r.RoomNo}" ${isExpiringSoon ? '' : 'checked'} style="width:18px;height:18px;flex-shrink:0;">
            <div style="flex:1;">
              <div style="font-weight:700;">${r.RoomNo} 房 · ${r.TenantName || '空房'}</div>
              <div class="hint">每月 $${r.RentAmount || 0}（${r.RentCycle || ''}）· 已繳至 ${r.NextRentDueDate || '未設定'}</div>
              ${isExpiringSoon ? `<div class="hint" style="color:var(--danger);">⚠️ 合約 ${r.ContractEnd} 到期，即將退租</div>` : ''}
            </div>
            <div style="width:70px;">
              <input type="number" min="1" value="${cycleDefault}" class="rent-overview-months" data-room="${r.RoomNo}"
                style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--line);text-align:center;">
            </div>
          </div>
        </label>`;
      }).join('')}
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" id="btn-confirm-rent-overview">產生勾選房間的租金帳單</button>
    </div>
    <div id="rent-overview-status" class="hint" style="margin-top:8px;"></div>
  `);

  const confirmBtn = document.getElementById('btn-confirm-rent-overview');
  confirmBtn.addEventListener('click', () => runLocked(confirmBtn, async () => {
    const checks = Array.from(document.querySelectorAll('.rent-overview-check')).filter(c => c.checked);
    if (checks.length === 0) { toast('沒有勾選任何房間'); return; }
    const statusEl = document.getElementById('rent-overview-status');
    let successCount = 0;
    const batch = [];
    for (const check of checks) {
      const roomNo = check.dataset.room;
      const monthsInput = document.querySelector(`.rent-overview-months[data-room="${roomNo}"]`);
      const months = Number(monthsInput.value || 1);
      statusEl.textContent = `處理中… ${roomNo} 房`;

      const res = await apiPost('generateRentBill', { roomNo, months });
      if (res.ok) {
        successCount++;
        batch.push({ billId: res.result.billId, roomNo, months });
      }
    }
    statusEl.textContent = `完成！已產生 ${successCount} 筆租金帳單`;
    if (successCount > 0) {
      pushHistory({
        label: `批次產生 ${successCount} 筆租金帳單`,
        undo: async () => { for (const b of batch) await apiPost('deleteBill', { billId: b.billId }); },
        redo: async () => { for (const b of batch) await apiPost('generateRentBill', { roomNo: b.roomNo, months: b.months }); }
      });
    }
    toast(`已產生 ${successCount} 筆租金帳單`);
    await refreshData();
    renderAll();
  }));
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
    if (days !== null && days < 90) {
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

  const confirmBtn = document.getElementById('btn-confirm-rentbill');
  confirmBtn.addEventListener('click', () => runLocked(confirmBtn, async () => {
    const months = Number(document.getElementById('rb-months').value || 1);
    const res = await apiPost('generateRentBill', { roomNo: room.RoomNo, months });
    if (res.ok) {
      pushHistory({
        label: `${room.RoomNo} 房產生租金帳單`,
        undo: () => apiPost('deleteBill', { billId: res.result.billId }),
        redo: () => apiPost('generateRentBill', { roomNo: room.RoomNo, months })
      });
      toast('已產生租金待繳帳單');
      closeModal();
      await refreshData();
      renderAll();
    } else {
      toast('失敗：' + res.error);
    }
  }));
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

  const saveBtn = document.getElementById('btn-save-room');
  saveBtn.addEventListener('click', () => runLocked(saveBtn, async () => {
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

    if (isEdit) {
      const prevPayload = roomToUpdatePayload(room);
      const res = await apiPost('updateRoom', data);
      if (res.ok) {
        pushHistory({
          label: `編輯房間 ${data.roomNo}`,
          undo: () => apiPost('updateRoom', prevPayload),
          redo: () => apiPost('updateRoom', data)
        });
        toast('已儲存'); closeModal(); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    } else {
      const res = await apiPost('addRoom', data);
      if (res.ok) {
        pushHistory({
          label: `新增房間 ${data.roomNo}`,
          undo: () => apiPost('deleteRoom', { roomNo: data.roomNo }),
          redo: () => apiPost('addRoom', data)
        });
        toast('已儲存'); closeModal(); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    }
  }));

  if (isEdit) {
    const delBtn = document.getElementById('btn-del-room');
    delBtn.addEventListener('click', () => runLocked(delBtn, async () => {
      if (!confirm(`確定要刪除 ${r.RoomNo} 房嗎？`)) return;
      const res = await apiPost('deleteRoom', { roomNo: r.RoomNo });
      if (res.ok) {
        pushHistory({
          label: `刪除房間 ${r.RoomNo}`,
          undo: () => apiPost('restoreRoom', r),
          redo: () => apiPost('deleteRoom', { roomNo: r.RoomNo })
        });
        toast('已刪除'); closeModal(); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    }));
  }
}

/**
 * 把從 STATE 讀到的房間物件（欄位名稱跟試算表欄位一致，例如 RoomNo、TenantName）
 * 轉換成 updateRoom 動作需要的欄位名稱（roomNo、tenantName…），供復原編輯用
 */
function roomToUpdatePayload(r) {
  return {
    roomNo: r.RoomNo,
    tenantName: r.TenantName,
    phone: r.Phone,
    deposit: r.Deposit,
    contractStart: r.ContractStart ? String(r.ContractStart).slice(0, 10) : '',
    contractEnd: r.ContractEnd ? String(r.ContractEnd).slice(0, 10) : '',
    rentCycle: r.RentCycle,
    rentAmount: r.RentAmount,
    lastMeterReading: r.LastMeterReading,
    lastMeterDate: r.LastMeterDate ? String(r.LastMeterDate).slice(0, 10) : '',
    nextRentDueDate: r.NextRentDueDate ? String(r.NextRentDueDate).slice(0, 10) : '',
    note: r.Note
  };
}

/* ============================================================
 * 抄表 / 電租合一帳單
 * ============================================================ */
function initMeterTab() {
  document.getElementById('meter-room-select').addEventListener('change', () => {
    updateMeterLastReading();
    updateRentPreview();
  });
  document.getElementById('btn-calc-bill').addEventListener('click', function () {
    runLocked(this, calcAndGenerateBill);
  });

  const includeRentBox = document.getElementById('meter-include-rent');
  const monthsWrap = document.getElementById('meter-rent-months-wrap');
  includeRentBox.addEventListener('change', () => {
    monthsWrap.style.display = includeRentBox.checked ? 'block' : 'none';
    updateRentPreview();
  });
  document.getElementById('meter-rent-months').addEventListener('input', updateRentPreview);

  document.getElementById('btn-batch-generate').addEventListener('click', function () {
    runLocked(this, runBatchMeterGenerate);
  });

  document.getElementById('bill-filter-room').addEventListener('change', renderMeterRecentBills);
  document.getElementById('bill-filter-status').addEventListener('change', renderMeterRecentBills);
}

function renderBatchMeterTable() {
  const rooms = (STATE.rooms || []).slice().sort((a, b) => String(a.RoomNo).localeCompare(String(b.RoomNo)));
  const el = document.getElementById('batch-meter-table');
  if (rooms.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="icon">🛏️</div><div class="msg">尚未新增房間</div></div>`;
    return;
  }
  el.innerHTML = rooms.map((r, i) => {
    const cycleDefault = r.RentCycle === '雙月繳' ? 2 : (r.RentCycle === '季繳' ? 3 : 1);
    const paidThrough = r.NextRentDueDate || '未設定';
    const days = daysUntil(r.NextRentDueDate);
    const contractDays = daysUntil(r.ContractEnd);
    const isExpiringSoon = contractDays !== null && contractDays < 30;

    // 系統建議：已繳至日期在 30 天內到期或已過期，就預先勾選提醒這次順便收租；
    // 但如果合約快到期（房客即將退租），就不建議收租，退租電費另外於當天結算
    const suggestCollect = !isExpiringSoon && days !== null && days <= 30;

    let dueBadge;
    if (days === null) {
      dueBadge = `<span class="badge neutral">未設定已繳至</span>`;
    } else if (days < 0) {
      dueBadge = `<span class="badge danger">已繳至 ${paidThrough}（已到期 ${Math.abs(days)} 天）</span>`;
    } else if (days <= 30) {
      dueBadge = `<span class="badge warn">已繳至 ${paidThrough}（${days} 天內到期）</span>`;
    } else {
      dueBadge = `<span class="badge success">已繳至 ${paidThrough}（還有 ${days} 天）</span>`;
    }

    const moveOutNote = isExpiringSoon
      ? `<div class="hint" style="color:var(--danger);margin-top:4px;">⚠️ 合約 ${r.ContractEnd} 到期，即將退租，不建議收租，電費請於退租當天結算</div>`
      : '';

    return `
    <div class="card" style="padding:10px 12px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:56px;font-weight:700;">${r.RoomNo}</div>
        <div style="flex:1;font-size:12.5px;color:var(--ink-soft);">${r.TenantName || '空房'} · 上次 ${r.LastMeterReading || 0} 度</div>
        <input type="number" inputmode="decimal" enterkeyhint="next"
          class="batch-meter-input" data-room="${r.RoomNo}" data-index="${i}"
          placeholder="本次讀數" style="width:110px;padding:9px;border-radius:8px;border:1px solid var(--line);text-align:right;">
      </div>
      <div style="margin-top:6px;padding-left:64px;">
        <span class="badge neutral">${r.RentCycle || '未設定'}</span>
        ${dueBadge}
      </div>
      ${moveOutNote}
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding-left:64px;">
        <input type="checkbox" class="batch-rent-check" data-room="${r.RoomNo}" ${suggestCollect ? 'checked' : ''} style="width:16px;height:16px;">
        <label style="margin:0;font-size:12.5px;">順便收租${suggestCollect ? '（系統建議）' : ''}</label>
        <input type="number" min="1" value="${cycleDefault}" class="batch-rent-months" data-room="${r.RoomNo}"
          style="width:50px;padding:6px;border-radius:6px;border:1px solid var(--line);text-align:center;font-size:12.5px;${suggestCollect ? '' : 'display:none;'}">
      </div>
    </div>`;
  }).join('');

  // Enter / 下一步 直接跳到下一列的電表輸入框，比照電腦鍵盤 Enter 操作習慣
  el.querySelectorAll('.batch-meter-input').forEach((input, idx, all) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = all[idx + 1];
        if (next) next.focus();
      }
    });
  });

  el.querySelectorAll('.batch-rent-check').forEach(box => {
    box.addEventListener('change', () => {
      const monthsInput = el.querySelector(`.batch-rent-months[data-room="${box.dataset.room}"]`);
      monthsInput.style.display = box.checked ? 'inline-block' : 'none';
    });
  });
}

async function runBatchMeterGenerate() {
  const allRoomInputs = Array.from(document.querySelectorAll('.batch-meter-input'));
  const inputs = allRoomInputs.filter(i => i.value !== '');
  if (inputs.length === 0) { toast('請至少輸入一間房間的電表數字'); return; }

  const skippedRooms = allRoomInputs.filter(i => i.value === '').map(i => i.dataset.room);

  const resultsEl = document.getElementById('batch-meter-results');
  resultsEl.innerHTML = '';
  let successCount = 0;
  const failedRooms = [];
  const batch = [];

  for (const input of inputs) {
    const roomNo = input.dataset.room;
    const newReading = input.value;
    const rentCheck = document.querySelector(`.batch-rent-check[data-room="${roomNo}"]`);
    const rentMonths = rentCheck && rentCheck.checked
      ? Number(document.querySelector(`.batch-rent-months[data-room="${roomNo}"]`).value || 1)
      : 0;

    // 先記住這間房操作前的電表狀態，復原時才能精準退回去（已繳至日期現在只在標記已繳時才會變動，這裡不用管）
    const prevRoom = (STATE.rooms || []).find(r => String(r.RoomNo) === String(roomNo));
    const restoreFields = prevRoom ? {
      lastMeterReading: prevRoom.LastMeterReading || 0,
      lastMeterDate: prevRoom.LastMeterDate || ''
    } : null;

    const res = await apiPost('recordMeterAndBill', { roomNo, newReading, rentMonths });
    if (res.ok) {
      successCount++;
      const r = res.result;
      batch.push({ billId: r.billId, roomNo, newReading, rentMonths, restoreFields, adHocRentBillId: r.adHocRentBillId || null });
      resultsEl.insertAdjacentHTML('beforeend', `
        <div class="bill-ticket">
          <div class="ticket-title">📋 ${roomNo} 房帳單已產生</div>
          <pre>${r.billText}</pre>
          <button class="btn btn-primary btn-copy-batch" data-text="${encodeURIComponent(r.billText)}" style="margin-top:12px;">📋 一鍵複製到 LINE</button>
        </div>`);
    } else {
      failedRooms.push(roomNo);
      resultsEl.insertAdjacentHTML('beforeend', `
        <div class="card" style="border-color:var(--danger);">
          <div style="font-weight:700;color:var(--danger);">${roomNo} 房失敗</div>
          <div class="hint">${res.error}</div>
        </div>`);
    }
  }

  // 清楚列出這次總共有幾間房、跳過幾間（沒輸入）、成功幾筆、失敗幾筆，避免「沒跑出來」卻不知道原因
  const summaryHtml = `
    <div class="card" style="border-color:var(--primary);">
      <div style="font-weight:700;margin-bottom:4px;">本次批次結果</div>
      <div class="hint">總房間數：${allRoomInputs.length}　｜　本次有輸入：${inputs.length}　｜　成功：${successCount}　｜　失敗：${failedRooms.length}</div>
      ${skippedRooms.length > 0 ? `<div class="hint" style="color:var(--warn);margin-top:4px;">本次未輸入、已略過：${skippedRooms.join('、')}</div>` : ''}
      ${failedRooms.length > 0 ? `<div class="hint" style="color:var(--danger);margin-top:4px;">失敗房間：${failedRooms.join('、')}（詳細原因見下方紅框）</div>` : ''}
    </div>`;
  resultsEl.insertAdjacentHTML('afterbegin', summaryHtml);

  if (successCount > 0) {
    pushHistory({
      label: `批次抄表 ${successCount} 筆`,
      undo: async () => {
        for (const b of batch.slice().reverse()) {
          await apiPost('undoBillAndRestoreRoom', { billId: b.billId, roomNo: b.roomNo, restoreFields: b.restoreFields });
          // 如果這間房的租金帳單是這次順手臨時產生的，復原時要整筆刪除，不能只是解除合併變回待繳
          if (b.adHocRentBillId) {
            await apiPost('deleteBill', { billId: b.adHocRentBillId });
          }
        }
      },
      redo: async () => {
        for (const b of batch) {
          await apiPost('recordMeterAndBill', { roomNo: b.roomNo, newReading: b.newReading, rentMonths: b.rentMonths });
        }
      }
    });
  }

  resultsEl.querySelectorAll('.btn-copy-batch').forEach(btn => {
    btn.addEventListener('click', () => copyBillText(decodeURIComponent(btn.dataset.text)));
  });

  toast(`已產生 ${successCount} 筆帳單`);
  document.querySelectorAll('.batch-meter-input').forEach(i => i.value = '');
  document.querySelectorAll('.batch-rent-check').forEach(c => c.checked = false);
  document.querySelectorAll('.batch-rent-months').forEach(m => m.style.display = 'none');
  await refreshData();
  renderAll();
}

function updateRentPreview() {
  const includeRentBox = document.getElementById('meter-include-rent');
  if (!includeRentBox.checked) return;
  const roomNo = document.getElementById('meter-room-select').value;
  const room = (STATE.rooms || []).find(r => String(r.RoomNo) === String(roomNo));
  if (!room) return;
  const months = Number(document.getElementById('meter-rent-months').value || 1);
  const amount = Number(room.RentAmount) * months;
  document.getElementById('meter-rent-preview').textContent = `這次租金：每月 $${room.RentAmount} × ${months} 個月 = $${amount}`;
}

function renderMeterRoomOptions() {
  const sel = document.getElementById('meter-room-select');
  const rooms = (STATE.rooms || []).slice().sort((a, b) => String(a.RoomNo).localeCompare(String(b.RoomNo)));
  sel.innerHTML = rooms.map(r => `<option value="${r.RoomNo}">${r.RoomNo} 房 - ${r.TenantName || '空房'}</option>`).join('');
  updateMeterLastReading();
  updateRentPreview();
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

  const includeRent = document.getElementById('meter-include-rent').checked;
  const rentMonths = includeRent ? Number(document.getElementById('meter-rent-months').value || 1) : 0;

  const prevRoom = (STATE.rooms || []).find(r => String(r.RoomNo) === String(roomNo));
  const restoreFields = prevRoom ? {
    lastMeterReading: prevRoom.LastMeterReading || 0,
    lastMeterDate: prevRoom.LastMeterDate || ''
  } : null;

  const res = await apiPost('recordMeterAndBill', { roomNo, newReading, rentMonths });
  if (!res.ok) { toast('失敗：' + res.error); return; }

  const r = res.result;
  pushHistory({
    label: `${roomNo} 房抄表帳單`,
    undo: async () => {
      await apiPost('undoBillAndRestoreRoom', { billId: r.billId, roomNo, restoreFields });
      if (r.adHocRentBillId) await apiPost('deleteBill', { billId: r.adHocRentBillId });
    },
    redo: () => apiPost('recordMeterAndBill', { roomNo, newReading, rentMonths })
  });

  document.getElementById('meter-result').innerHTML = `
    <div class="bill-ticket">
      <div class="ticket-title">📋 帳單已產生（${roomNo} 房）</div>
      <pre id="bill-text-content">${r.billText}</pre>
      <button class="btn btn-primary" id="btn-copy-bill" style="margin-top:12px;">📋 一鍵複製到 LINE</button>
    </div>`;
  document.getElementById('btn-copy-bill').addEventListener('click', () => copyBillText(r.billText));

  document.getElementById('meter-new').value = '';
  document.getElementById('meter-include-rent').checked = false;
  document.getElementById('meter-rent-months-wrap').style.display = 'none';
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

function buildFallbackBillText(bill) {
  const titleMap = { '電費': '電費帳單', '租金': '房租帳單', '合併': '電費+房租 帳單' };
  const title = titleMap[bill.Type] || '帳單';
  return '家人們 午安～\n' +
    '【' + bill.RoomNo + ' 房】' + title + '\n\n' +
    bill.DetailText + '\n' +
    '－－－－－－－－\n' +
    '合計應繳：' + fmtMoney(bill.Amount) + '\n\n' +
    '麻煩於期限內完成繳費\n' +
    '繳費後記得回傳明細供對帳哦\n' +
    '若有問題再請不吝指教，3Q🙇‍♂️';
}

function renderMeterRecentBills() {
  // 填入房間篩選選單（保留使用者目前選的值）
  const roomFilterEl = document.getElementById('bill-filter-room');
  const currentRoomFilter = roomFilterEl.value;
  const rooms = (STATE.rooms || []).slice().sort((a, b) => String(a.RoomNo).localeCompare(String(b.RoomNo)));
  roomFilterEl.innerHTML = '<option value="">全部房間</option>' +
    rooms.map(r => `<option value="${r.RoomNo}">${r.RoomNo} 房</option>`).join('');
  roomFilterEl.value = currentRoomFilter;

  const roomFilter = roomFilterEl.value;
  const statusFilter = document.getElementById('bill-filter-status').value;
  const showMerged = document.getElementById('meter-show-merged') &&
    document.getElementById('meter-show-merged').checked;

  const allBills = (STATE.bills || []).slice().sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
  const mergedCount = allBills.filter(b => String(b.Status).indexOf('已合併') === 0).length;

  let bills = showMerged ? allBills : allBills.filter(b => String(b.Status).indexOf('已合併') !== 0);
  if (roomFilter) bills = bills.filter(b => String(b.RoomNo) === String(roomFilter));
  if (statusFilter) bills = bills.filter(b => b.Status === statusFilter);

  const el = document.getElementById('meter-recent-bills');
  const toggleHtml = mergedCount > 0 ? `
    <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-soft);margin:8px 0;cursor:pointer;">
      <input type="checkbox" id="meter-show-merged" ${showMerged ? 'checked' : ''} style="width:14px;height:14px;">
      顯示已合併的舊帳單紀錄（共 ${mergedCount} 筆，正常情況下不需要處理）
    </label>` : '';
  const countHtml = `<div class="hint" style="margin-bottom:8px;">共 ${bills.length} 筆</div>`;

  if (bills.length === 0) {
    el.innerHTML = toggleHtml + countHtml + `<div class="empty-state"><div class="icon">⚡</div><div class="msg">沒有符合條件的帳單</div></div>`;
    bindBillListEvents_(el);
    return;
  }
  el.innerHTML = toggleHtml + countHtml + bills.map(b => {
    const statusBadge = b.Status === '待繳'
      ? '<span class="badge warn">待繳</span>'
      : (String(b.Status).indexOf('已合併') === 0
        ? '<span class="badge neutral">已合併（歷史紀錄，不用處理）</span>'
        : '<span class="badge success">已繳</span>');
    const paidAtLine = b.Status === '已繳' && b.PaidAt
      ? `<div class="hint">繳費日期：${String(b.PaidAt).slice(0, 10)}</div>` : '';
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;">${b.RoomNo} 房 · ${b.Type}</div>
            <div class="hint">${b.PeriodLabel}</div>
            ${paidAtLine}
          </div>
          <div style="text-align:right;">
            <div class="num" style="font-weight:800;">${fmtMoney(b.Amount)}</div>
            ${statusBadge}
          </div>
        </div>
        <div class="btn-row">
          ${b.Status === '待繳' ? `<button class="btn btn-outline btn-sm mark-paid" data-id="${b.BillID}">標記為已繳</button>` : ''}
          <button class="btn btn-primary btn-sm copy-bill" data-id="${b.BillID}">📋 複製</button>
          <button class="btn btn-outline btn-sm edit-bill" data-id="${b.BillID}">編輯</button>
          <button class="btn btn-danger btn-sm delete-bill" data-id="${b.BillID}">刪除</button>
        </div>
      </div>`;
  }).join('');
  bindBillListEvents_(el);
}

function bindBillListEvents_(el) {
  if (document.getElementById('meter-show-merged')) {
    document.getElementById('meter-show-merged').addEventListener('change', renderMeterRecentBills);
  }
  el.querySelectorAll('.copy-bill').forEach(btn => {
    btn.addEventListener('click', () => {
      const bill = (STATE.bills || []).find(x => x.BillID === btn.dataset.id);
      if (!bill) return;
      const text = bill.BillText && bill.BillText.trim()
        ? bill.BillText
        : buildFallbackBillText(bill); // 舊資料若還沒有 BillText 欄位，用現有欄位組一份堪用的文字
      copyBillText(text);
    });
  });
  el.querySelectorAll('.mark-paid').forEach(btn => {
    btn.addEventListener('click', () => runLocked(btn, async () => {
      const billId = btn.dataset.id;
      const res = await apiPost('markBillPaid', { billId });
      if (res.ok) {
        pushHistory({
          label: `標記帳單已繳`,
          undo: () => apiPost('unmarkBillPaid', { billId }),
          redo: () => apiPost('markBillPaid', { billId })
        });
        toast('已標記為已繳'); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    }));
  });
  el.querySelectorAll('.edit-bill').forEach(btn => {
    btn.addEventListener('click', () => openBillEditModal(btn.dataset.id));
  });
  el.querySelectorAll('.delete-bill').forEach(btn => {
    btn.addEventListener('click', () => runLocked(btn, async () => {
      if (!confirm('確定要刪除這筆帳單嗎？')) return;
      const billId = btn.dataset.id;
      const billSnapshot = (STATE.bills || []).find(x => x.BillID === billId);
      const res = await apiPost('deleteBill', { billId });
      if (res.ok) {
        pushHistory({
          label: `刪除帳單（${billSnapshot ? billSnapshot.RoomNo : ''} 房）`,
          undo: () => apiPost('restoreBill', billSnapshot),
          redo: () => apiPost('deleteBill', { billId })
        });
        toast('已刪除帳單'); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    }));
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
  const saveBtn = document.getElementById('btn-save-bill');
  saveBtn.addEventListener('click', () => runLocked(saveBtn, async () => {
    const prevPayload = { billId, periodLabel: bill.PeriodLabel, detailText: bill.DetailText, amount: bill.Amount };
    const data = {
      billId: billId,
      periodLabel: document.getElementById('eb-period').value.trim(),
      detailText: document.getElementById('eb-detail').value,
      amount: Number(document.getElementById('eb-amount').value || 0)
    };
    const res = await apiPost('updateBill', data);
    if (res.ok) {
      pushHistory({
        label: `編輯帳單（${bill.RoomNo} 房）`,
        undo: () => apiPost('updateBill', prevPayload),
        redo: () => apiPost('updateBill', data)
      });
      toast('已儲存'); closeModal(); await refreshData(); renderAll();
    } else {
      toast('失敗：' + res.error);
    }
  }));
}

/* ============================================================
 * 未分類收款
 * ============================================================ */
function initPaymentsTab() {
  const timeInput = document.getElementById('manual-payment-time');
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  timeInput.value = now.toISOString().slice(0, 16);

  const addPaymentBtn = document.getElementById('btn-add-manual-payment');
  addPaymentBtn.addEventListener('click', () => runLocked(addPaymentBtn, async () => {
    const amount = Number(document.getElementById('manual-payment-amount').value || 0);
    const receivedTime = document.getElementById('manual-payment-time').value;
    if (!amount) { toast('請輸入金額'); return; }
    const res = await apiPost('addManualPayment', { amount, receivedTime });
    if (res.ok) {
      const paymentId = res.result.paymentId;
      pushHistory({
        label: `新增收款 ${fmtMoney(amount)}`,
        undo: () => apiPost('deletePayment', { paymentId }),
        redo: () => apiPost('addManualPayment', { amount, receivedTime })
      });
      toast('已新增收款');
      document.getElementById('manual-payment-amount').value = '';
      await refreshData();
      renderAll();
    } else {
      toast('失敗：' + res.error);
    }
  }));

  const input = document.getElementById('payment-photo-input');
  const statusEl = document.getElementById('payment-photo-status');
  const uploadBtn = document.getElementById('btn-upload-payment-photo');
  uploadBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', () => runLocked(uploadBtn, async () => {
    const file = input.files[0];
    if (!file) return;
    statusEl.textContent = '辨識中，請稍候…（可能需要 5-15 秒）';

    try {
      const base64 = await fileToBase64_(file);
      const mimeType = file.type || 'image/png';
      const res = await apiPost('ocrImportImage', { imageBase64: base64, mimeType });
      if (!res.ok) {
        statusEl.textContent = '失敗：' + res.error;
        toast('辨識失敗：' + res.error);
      } else if (res.result.imported > 0) {
        const items = res.result.items || [];
        statusEl.textContent = `成功匯入 ${res.result.imported} 筆收款！`;
        pushHistory({
          label: `照片辨識匯入 ${res.result.imported} 筆收款`,
          undo: async () => { for (const it of items) await apiPost('deletePayment', { paymentId: it.paymentId }); },
          redo: () => apiPost('ocrImportImage', { imageBase64: base64, mimeType })
        });
        toast(`已匯入 ${res.result.imported} 筆收款`);
        await refreshData();
        renderAll();
      } else {
        statusEl.textContent = res.result.error || '沒有辨識到有效的收款資訊';
        toast('沒有辨識到有效的收款資訊');
      }
    } catch (err) {
      statusEl.textContent = '發生錯誤：' + err.message;
      toast('上傳失敗，請再試一次');
    }
    input.value = '';
  }));
}

function fileToBase64_(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data:image/png;base64,xxxx
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
    btn.addEventListener('click', () => runLocked(btn, async () => {
      if (!confirm('確定要刪除這筆收款紀錄嗎？')) return;
      const paymentId = btn.dataset.id;
      const paymentSnapshot = (STATE.payments || []).find(x => x.PaymentID === paymentId);
      const res = await apiPost('deletePayment', { paymentId });
      if (res.ok) {
        pushHistory({
          label: `刪除收款 ${fmtMoney(paymentSnapshot ? paymentSnapshot.Amount : 0)}`,
          undo: () => apiPost('restorePayment', paymentSnapshot),
          redo: () => apiPost('deletePayment', { paymentId })
        });
        toast('已刪除'); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    }));
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
  const saveBtn = document.getElementById('btn-save-payment');
  saveBtn.addEventListener('click', () => runLocked(saveBtn, async () => {
    const prevAmount = payment.Amount;
    const amount = Number(document.getElementById('ep-amount').value || 0);
    const res = await apiPost('updatePayment', { paymentId, amount });
    if (res.ok) {
      pushHistory({
        label: `編輯收款金額`,
        undo: () => apiPost('updatePayment', { paymentId, amount: prevAmount }),
        redo: () => apiPost('updatePayment', { paymentId, amount })
      });
      toast('已儲存'); closeModal(); await refreshData(); renderAll();
    } else {
      toast('失敗：' + res.error);
    }
  }));
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
  const confirmBtn = document.getElementById('btn-confirm-assign');
  confirmBtn.addEventListener('click', () => runLocked(confirmBtn, async () => {
    const selected = document.querySelector('input[name="assign-bill"]:checked');
    if (!selected) { toast('請先選擇一筆帳單'); return; }
    const billId = selected.value;
    const res = await apiPost('assignPayment', { paymentId, billId });
    if (res.ok) {
      pushHistory({
        label: `核銷收款 ${fmtMoney(payment.Amount)}`,
        undo: () => apiPost('unassignPayment', { paymentId }),
        redo: () => apiPost('assignPayment', { paymentId, billId })
      });
      toast('已核銷完成'); closeModal(); await refreshData(); renderAll();
    } else {
      toast('失敗：' + res.error);
    }
  }));
  const ignoreBtn = document.getElementById('btn-ignore-payment');
  ignoreBtn.addEventListener('click', () => runLocked(ignoreBtn, async () => {
    const res = await apiPost('ignorePayment', { paymentId });
    if (res.ok) {
      pushHistory({
        label: `忽略收款 ${fmtMoney(payment.Amount)}`,
        undo: () => apiPost('unignorePayment', { paymentId }),
        redo: () => apiPost('ignorePayment', { paymentId })
      });
      toast('已忽略'); closeModal(); await refreshData(); renderAll();
    } else {
      toast('失敗：' + res.error);
    }
  }));
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
  const savePriceBtn = document.getElementById('btn-save-price');
  savePriceBtn.addEventListener('click', () => runLocked(savePriceBtn, async () => {
    const prevValue = STATE.settings ? STATE.settings.ElecUnitPrice : 5.5;
    const val = Number(document.getElementById('setting-elec-price').value);
    const res = await apiPost('updateSetting', { key: 'ElecUnitPrice', value: val });
    if (res.ok) {
      pushHistory({
        label: `電費單價改為 $${val}`,
        undo: () => apiPost('updateSetting', { key: 'ElecUnitPrice', value: prevValue }),
        redo: () => apiPost('updateSetting', { key: 'ElecUnitPrice', value: val })
      });
      toast('電費單價已更新'); await refreshData(); renderAll();
    }
  }));
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
      btn.addEventListener('click', () => runLocked(btn, async () => {
        if (!confirm('確定要刪除這筆支出嗎？')) return;
        const expenseId = btn.dataset.id;
        const expenseSnapshot = (STATE.expenses || []).find(x => x.ExpenseID === expenseId);
        const res = await apiPost('deleteExpense', { expenseId });
        if (res.ok) {
          pushHistory({
            label: `刪除支出 ${fmtMoney(expenseSnapshot ? expenseSnapshot.Amount : 0)}`,
            undo: () => apiPost('restoreExpense', expenseSnapshot),
            redo: () => apiPost('deleteExpense', { expenseId })
          });
          toast('已刪除'); await refreshData(); renderAll();
        } else {
          toast('失敗：' + res.error);
        }
      }));
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
        ${['電費', '水費', '廣告刊登', '維修保養', '清潔耗材', '稅金規費', '其他雜項'].map(c =>
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
  const saveBtn = document.getElementById('btn-save-expense');
  saveBtn.addEventListener('click', () => runLocked(saveBtn, async () => {
    const data = {
      date: document.getElementById('ex-date').value,
      category: document.getElementById('ex-category').value,
      amount: Number(document.getElementById('ex-amount').value || 0),
      note: document.getElementById('ex-note').value.trim()
    };
    if (!data.amount) { toast('請輸入金額'); return; }

    if (isEdit) {
      const prevPayload = { expenseId, date: String(ex.Date).slice(0, 10), category: ex.Category, amount: ex.Amount, note: ex.Note };
      const res = await apiPost('updateExpense', { ...data, expenseId });
      if (res.ok) {
        pushHistory({
          label: `編輯支出`,
          undo: () => apiPost('updateExpense', prevPayload),
          redo: () => apiPost('updateExpense', { ...data, expenseId })
        });
        toast('已儲存'); closeModal(); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    } else {
      const res = await apiPost('addExpense', data);
      if (res.ok) {
        const newExpenseId = res.result.expenseId;
        pushHistory({
          label: `新增支出 ${fmtMoney(data.amount)}`,
          undo: () => apiPost('deleteExpense', { expenseId: newExpenseId }),
          redo: () => apiPost('addExpense', data)
        });
        toast('已儲存'); closeModal(); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    }
  }));

  if (isEdit) {
    const delBtn = document.getElementById('btn-del-expense');
    delBtn.addEventListener('click', () => runLocked(delBtn, async () => {
      if (!confirm('確定要刪除這筆支出嗎？')) return;
      const res = await apiPost('deleteExpense', { expenseId });
      if (res.ok) {
        pushHistory({
          label: `刪除支出 ${fmtMoney(ex.Amount)}`,
          undo: () => apiPost('restoreExpense', ex),
          redo: () => apiPost('deleteExpense', { expenseId })
        });
        toast('已刪除'); closeModal(); await refreshData(); renderAll();
      } else {
        toast('失敗：' + res.error);
      }
    }));
  }
}
