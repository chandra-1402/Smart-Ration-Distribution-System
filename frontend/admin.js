document.addEventListener('DOMContentLoaded', () => {
    // Screens & Layout
    const loginScreen = document.getElementById('login-screen');
    const adminLayout = document.getElementById('admin-layout');
    
    // Login Elements
    const loginEmail = document.getElementById('login-email');
    const loginPass = document.getElementById('login-password');
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');

    // Navigation
    const navItems = document.querySelectorAll('.nav-item[data-target]');
    const views = document.querySelectorAll('.view');
    const logoutBtn = document.getElementById('logout-btn');

    let adminToken = null;
    let editModeId = null;

    // Login Action
    loginBtn.addEventListener('click', async () => {
        const email = loginEmail.value.trim();
        const password = loginPass.value;
        if(!email || !password) return;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if(!res.ok) throw new Error(data.detail || 'Login Failed');

            adminToken = data.token;
            loginScreen.classList.remove('active');
            adminLayout.classList.remove('hidden');
            adminLayout.classList.add('active');
            
            // Load initial dashboard data
            loadDashboard();
        } catch(e) {
            loginError.textContent = e.message;
            loginError.classList.remove('hidden');
        }
    });

    // Navigation Logic
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            const target = item.getAttribute('data-target');
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(`view-${target}`).classList.add('active');

            if(target === 'dashboard') loadDashboard();
            if(target === 'beneficiaries') loadBeneficiaries();
            if(target === 'transactions') loadTransactions();
            if(target === 'reports') loadReports();
            if(target === 'machine') loadMachineStatus();
            if(target === 'diagnostics') loadDiagnostics();
        });
    });

    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        adminToken = null;
        adminLayout.classList.remove('active');
        adminLayout.classList.add('hidden');
        loginScreen.classList.add('active');
        loginEmail.value = '';
        loginPass.value = '';
    });

    // Data Loaders
    async function loadReports() {
        try {
            const res = await fetch('/api/reports');
            const data = await res.json();
            document.getElementById('rep-beneficiaries').textContent = data.total_beneficiaries;
            document.getElementById('rep-transactions').textContent = data.total_transactions;
            document.getElementById('rep-dispensed').textContent = data.total_quantity_dispensed.toFixed(2) + ' KG';
            document.getElementById('rep-success').textContent = data.successful_transactions;
            document.getElementById('rep-rejected').textContent = data.rejected_transactions;
            document.getElementById('rep-avg').textContent = data.average_quantity_dispensed.toFixed(2) + ' KG';
        } catch(e) { console.error('Reports Error', e); }
    }
    async function loadDashboard() {
        try {
            const res = await fetch('/api/dashboard/stats');
            const data = await res.json();
            
            document.getElementById('stat-beneficiaries').textContent = data.total_beneficiaries;
            document.getElementById('stat-transactions').textContent = data.today_transactions;
            document.getElementById('stat-dispensed').textContent = data.ration_dispensed.toFixed(2) + ' KG';
            const statusEl = document.getElementById('stat-machine');
            statusEl.textContent = data.machine_status;
            if (data.machine_status === 'OFFLINE') {
                statusEl.style.color = 'var(--error)';
            } else {
                statusEl.style.color = 'var(--success)';
            }

            // Load recent transactions (limiting to 5 for dashboard)
            const txRes = await fetch('/api/transactions');
            const txData = await txRes.json();
            renderTransactionsTable(txData.slice(0, 5), 'dashboard-recent-txns');
        } catch(e) { console.error('Dashboard Error', e); }
    }

    async function loadBeneficiaries() {
        try {
            const res = await fetch('/api/beneficiaries');
            const data = await res.json();
            const tbody = document.getElementById('beneficiaries-list');
            tbody.innerHTML = '';
            
            data.forEach(b => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${b.beneficiary_id}</td>
                    <td>${b.name}</td>
                    <td>${b.family_members}</td>
                    <td>${b.monthly_entitlement.toFixed(2)} KG</td>
                    <td>${b.collected_quantity.toFixed(2)} KG</td>
                    <td>${b.remaining_quantity.toFixed(2)} KG</td>
                    <td><span style="color: ${b.status === 'Active' ? 'var(--success)' : 'var(--error)'}">${b.status}</span></td>
                    <td><a class="edit-link" data-id="${b.id}" data-full='${JSON.stringify(b)}'>Edit</a></td>
                `;
                tbody.appendChild(tr);
            });

            document.querySelectorAll('.edit-link').forEach(el => {
                el.addEventListener('click', (e) => {
                    const bData = JSON.parse(e.target.getAttribute('data-full'));
                    openBeneficiaryModal(bData);
                });
            });
        } catch(e) { console.error(e); }
    }

    async function loadTransactions() {
        try {
            const res = await fetch('/api/transactions');
            const data = await res.json();
            renderTransactionsTable(data, 'transactions-list');
        } catch(e) { console.error(e); }
    }

    const clearTransactionsBtn = document.getElementById('clear-transactions-btn');
    if(clearTransactionsBtn) {
        clearTransactionsBtn.addEventListener('click', async () => {
            if(!confirm("Are you sure you want to delete all transactions? This cannot be undone.")) return;
            try {
                const res = await fetch('/api/transactions', { method: 'DELETE' });
                if(res.ok) {
                    loadTransactions();
                    loadDashboard(); // Update stats
                }
            } catch(e) { console.error('Error clearing transactions', e); }
        });
    }

    const exportCsvBtn = document.getElementById('export-csv-btn');
    if(exportCsvBtn) {
        exportCsvBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/transactions');
                const data = await res.json();
                
                if (data.length === 0) {
                    alert("No transactions to export.");
                    return;
                }
                
                const headers = ["Transaction ID", "Beneficiary ID", "Target Quantity (kg)", "Actual Quantity (kg)", "Status", "Date"];
                const csvRows = [];
                csvRows.push(headers.join(','));
                
                for (const row of data) {
                    const dateStr = new Date(row.created_at).toLocaleString().replace(/,/g, '');
                    const values = [
                        row.transaction_id,
                        row.beneficiary_id,
                        row.target_quantity,
                        row.actual_quantity,
                        row.status,
                        dateStr
                    ];
                    csvRows.push(values.join(','));
                }
                
                const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `pmgkay_transactions_${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } catch(e) { console.error('Error exporting CSV', e); }
        });
    }

    function renderTransactionsTable(data, elementId) {
        const tbody = document.getElementById(elementId);
        tbody.innerHTML = '';
        
        if (data.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="6" style="text-align: center; color: var(--text-muted);">No transactions found</td>`;
            tbody.appendChild(tr);
            return;
        }

        data.forEach(t => {
            const dateStr = new Date(t.created_at).toLocaleString();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${t.transaction_id}</td>
                <td>${t.beneficiary_id}</td>
                <td>${t.target_quantity.toFixed(2)} KG</td>
                <td>${t.actual_quantity.toFixed(2)} KG</td>
                <td>${dateStr}</td>
                <td style="color: var(--success)">${t.status}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    async function loadMachineStatus() {
        try {
            const res = await fetch('/api/machine/status');
            const data = await res.json();
            
            const modeBadge = document.getElementById('mach-mode-badge');
            if (modeBadge) {
                modeBadge.textContent = data.mode;
                if (data.mode === 'HARDWARE') {
                    modeBadge.style.backgroundColor = 'var(--success)';
                } else {
                    modeBadge.style.backgroundColor = 'var(--saffron)';
                }
            }
            
            document.getElementById('mach-esp32').textContent = data.components.esp32;
            document.getElementById('mach-arduino').textContent = data.components.arduino;
            document.getElementById('mach-loadcell').textContent = data.components.load_cell;
            document.getElementById('mach-servo').textContent = data.components.servo;
        } catch(e) { console.error(e); }
    }

    async function loadDiagnostics() {
        try {
            const res = await fetch('/api/hardware/diagnostics');
            const data = await res.json();
            
            // Helper to update a sensor card
            const updateCard = (key, dataObj) => {
                const statusEl = document.getElementById(`diag-${key}-status`);
                const valEl = document.getElementById(`diag-${key}-val`);
                if(statusEl && valEl && dataObj) {
                    if (dataObj.status === 'OK') {
                        statusEl.textContent = 'CONNECTED';
                    } else {
                        statusEl.textContent = dataObj.status;
                    }
                    valEl.textContent = dataObj.value;
                    if(dataObj.status === 'OK') {
                        statusEl.style.backgroundColor = 'var(--success)';
                        statusEl.style.color = '#fff';
                    } else if (dataObj.status === 'ERROR') {
                        statusEl.style.backgroundColor = 'var(--error)';
                        statusEl.style.color = '#fff';
                    } else {
                        statusEl.style.backgroundColor = 'var(--border-light)';
                        statusEl.style.color = 'var(--text-primary)';
                    }
                }
            };
            
            updateCard('loadcell', data.load_cell);
            updateCard('servo', data.servo);
            updateCard('red', data.led_red);
            updateCard('yellow', data.led_yellow);
            updateCard('green', data.led_green);
            updateCard('lcd', data.lcd);
            
        } catch(e) { console.error(e); }
    }
    
    // Polling for real-time updates when Diagnostics or Machine view is active
    setInterval(() => {
        const activeNav = document.querySelector('.nav-item.active');
        if (activeNav && activeNav.dataset.target === 'diagnostics') {
            loadDiagnostics();
        } else if (activeNav && activeNav.dataset.target === 'machine') {
            loadMachineStatus();
        }
    }, 1000);

    // Modal Logic
    const modalOverlay = document.getElementById('modal-overlay');
    const addBtn = document.getElementById('add-beneficiary-btn');
    const modCancel = document.getElementById('mod-cancel');
    const modSave = document.getElementById('mod-save');

    addBtn.addEventListener('click', () => {
        openBeneficiaryModal();
    });
    
    modCancel.addEventListener('click', () => {
        modalOverlay.classList.add('hidden');
    });

    function openBeneficiaryModal(bData = null) {
        document.getElementById('mod-ben-id').value = bData ? bData.beneficiary_id : '';
        document.getElementById('mod-ben-name').value = bData ? bData.name : '';
        document.getElementById('mod-ben-members').value = bData ? bData.family_members : '1';
        document.getElementById('mod-ben-monthly').value = bData ? bData.monthly_entitlement : '10.0';
        document.getElementById('mod-ben-collected').value = bData ? bData.collected_quantity : '0.0';
        document.getElementById('mod-ben-status').value = bData ? bData.status : 'Active';
        
        editModeId = bData ? bData.id : null;
        document.getElementById('modal-title').textContent = bData ? 'Edit Beneficiary' : 'Add Beneficiary';
        modalOverlay.classList.remove('hidden');
    }

    modSave.addEventListener('click', async () => {
        const payload = {
            beneficiary_id: document.getElementById('mod-ben-id').value,
            name: document.getElementById('mod-ben-name').value,
            family_members: parseInt(document.getElementById('mod-ben-members').value),
            monthly_entitlement: parseFloat(document.getElementById('mod-ben-monthly').value),
            collected_quantity: parseFloat(document.getElementById('mod-ben-collected').value),
            status: document.getElementById('mod-ben-status').value
        };

        const url = editModeId ? `/api/beneficiaries/${editModeId}` : '/api/beneficiaries';
        const method = editModeId ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if(res.ok) {
                modalOverlay.classList.add('hidden');
                loadBeneficiaries();
            } else {
                const err = await res.json();
                alert('Error: ' + err.detail);
            }
        } catch(e) {
            console.error(e);
            alert('An error occurred');
        }
    });
});
