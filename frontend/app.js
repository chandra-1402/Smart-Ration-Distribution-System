document.addEventListener('DOMContentLoaded', () => {
    // Screens
    const verifyScreen = document.getElementById('verification-screen');
    const loadScreen = document.getElementById('loading-screen');
    const detailsScreen = document.getElementById('details-screen');
    const dispenseScreen = document.getElementById('dispensing-screen');
    const completeScreen = document.getElementById('completion-screen');

    // Inputs & Buttons
    const idInput = document.getElementById('beneficiary-id');
    const verifyBtn = document.getElementById('verify-btn');
    const errorMsg = document.getElementById('verify-error');
    const resetBtn = document.getElementById('reset-btn');

    // DOM Elements - Details
    const detName = document.getElementById('det-name');
    const detId = document.getElementById('det-id');
    const detMembers = document.getElementById('det-members');
    const detMonthly = document.getElementById('det-monthly');
    const detCollected = document.getElementById('det-collected');
    const detRemaining = document.getElementById('det-remaining');

    // DOM Elements - Dispense
    const dispCurrent = document.getElementById('disp-current');
    const dispProgress = document.getElementById('disp-progress');
    const dispPercentage = document.getElementById('disp-percentage');
    const dispTarget = document.getElementById('disp-target');
    const dispRemaining = document.getElementById('disp-remaining');
    const dispUid = document.getElementById('disp-uid');
    const dispUname = document.getElementById('disp-uname');

    // DOM Elements - Complete
    const compTarget = document.getElementById('comp-target');
    const compActual = document.getElementById('comp-actual');
    const compTxid = document.getElementById('comp-txid');
    const compUid = document.getElementById('comp-uid');
    const compDatetime = document.getElementById('comp-datetime');

    let ws = null;
    let currentBeneficiary = null;
    let currentJobId = null;

    // Helper: Show Screen
    function showScreen(screenEl) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        screenEl.classList.add('active');
    }

    let pollInterval = null;

    // Helper: Connect WebSocket or Poll
    function connectWebSocket() {
        if(pollInterval) clearInterval(pollInterval);
        
        // Start HTTP polling fallback every 500ms since localtunnel drops WebSockets
        pollInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/dispense/status');
                if(!res.ok) return;
                const data = await res.json();
                
                if (data.jobId === currentJobId) {
                    handleWeightUpdate(data);
                }
            } catch(e) {}
        }, 500);

        const wsUrl = new URL('/ws', window.location.href);
        wsUrl.protocol = wsUrl.protocol.replace('http', 'ws');
        
        if(ws) ws.close();
        ws = new WebSocket(wsUrl.href);
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if(data.type === 'weight:update' && data.payload.jobId === currentJobId) {
                handleWeightUpdate(data.payload);
            }
        };
    }

    verifyBtn.addEventListener('click', async () => {
        const id = idInput.value.trim();
        if(!id) return;

        errorMsg.classList.add('hidden');
        showScreen(loadScreen);

        try {
            const res = await fetch('/api/beneficiaries/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beneficiary_id: id })
            });

            const data = await res.json();

            if(!res.ok) {
                throw new Error(data.detail || 'Verification failed');
            }

            currentBeneficiary = data;
            
            // Populate Details
            detName.textContent = data.name;
            detId.textContent = data.beneficiary_id;
            detMembers.textContent = data.family_members;
            detMonthly.textContent = data.monthly_entitlement;
            detCollected.textContent = data.collected_quantity;
            detRemaining.textContent = data.remaining_quantity;

            showScreen(detailsScreen);

            // Wait 2.5 seconds then start dispensing
            setTimeout(() => startDispensing(data.beneficiary_id), 2500);

        } catch (err) {
            errorMsg.textContent = err.message;
            errorMsg.classList.remove('hidden');
            showScreen(verifyScreen);
        }
    });

    async function startDispensing(beneficiaryId) {
        try {
            const res = await fetch('/api/dispense/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beneficiary_id: beneficiaryId })
            });
            const data = await res.json();
            if(!res.ok) throw new Error(data.detail);

            currentJobId = data.job_id;
            
            // Setup dispense screen
            dispUid.textContent = currentBeneficiary.beneficiary_id;
            dispUname.textContent = currentBeneficiary.name;
            dispTarget.textContent = data.target_weight.toFixed(2) + ' KG';
            dispRemaining.textContent = data.target_weight.toFixed(2) + ' KG';
            dispCurrent.textContent = '0.00 KG';
            dispProgress.style.width = '0%';
            dispPercentage.textContent = '0%';

            connectWebSocket();
            showScreen(dispenseScreen);

        } catch(err) {
            alert("Error starting dispense: " + err.message);
            showScreen(verifyScreen);
        }
    }

    function handleWeightUpdate(payload) {
        const { currentWeight, targetWeight, status } = payload;
        
        dispCurrent.textContent = currentWeight.toFixed(2) + ' KG';
        const rem = Math.max(0, targetWeight - currentWeight);
        dispRemaining.textContent = rem.toFixed(2) + ' KG';
        
        const pct = Math.min(100, Math.round((currentWeight / targetWeight) * 100));
        dispProgress.style.width = pct + '%';
        dispPercentage.textContent = pct + '%';

        if(status === 'COMPLETED') {
            setTimeout(() => {
                showCompletionScreen(payload);
            }, 1000);
        }
    }

    function showCompletionScreen(payload) {
        compTarget.textContent = payload.targetWeight.toFixed(2) + ' KG';
        compActual.textContent = payload.currentWeight.toFixed(2) + ' KG';
        compTxid.textContent = payload.jobId;
        compUid.textContent = payload.beneficiaryId;
        compDatetime.textContent = new Date().toLocaleString();

        showScreen(completeScreen);
        if(ws) ws.close();
    }

    resetBtn.addEventListener('click', () => {
        idInput.value = '';
        errorMsg.classList.add('hidden');
        currentBeneficiary = null;
        currentJobId = null;
        showScreen(verifyScreen);
    });
});
