document.addEventListener('DOMContentLoaded', () => {
    // Screens
    const verifyScreen = document.getElementById('verification-screen');
    const faceAuthScreen = document.getElementById('face-auth-screen');
    const loadScreen = document.getElementById('loading-screen');
    const detailsScreen = document.getElementById('details-screen');
    const dispenseScreen = document.getElementById('dispensing-screen');
    const completeScreen = document.getElementById('completion-screen');

    // Inputs & Buttons
    const idInput = document.getElementById('beneficiary-id');
    const verifyBtn = document.getElementById('verify-btn');
    const errorMsg = document.getElementById('verify-error');
    const resetBtn = document.getElementById('reset-btn');
    const manualSnapBtn = document.getElementById('manual-snap-btn');
    const faceCancelBtn = document.getElementById('face-cancel-btn');

    // Face Auth Elements
    const faceVideo = document.getElementById('face-video');
    const faceCanvas = document.getElementById('face-canvas');
    const faceOval = document.getElementById('face-oval');
    const livenessPill = document.getElementById('liveness-pill');
    const livenessIcon = document.getElementById('liveness-icon');
    const livenessText = document.getElementById('liveness-text');
    const faceBenInfo = document.getElementById('face-ben-info');
    const detPhoto = document.getElementById('det-photo');

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
                const res = await fetch(`/api/dispense/status?t=${Date.now()}`, { cache: 'no-store' });
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

    // --- Camera & Aadhaar Face Liveness State ---
    let cameraStream = null;
    let cameraInstance = null;
    let faceMesh = null;
    let isAuthenticating = false;
    let eyesClosed = false;
    let eyesClosedStartTime = 0;

    function playCaptureChime() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
            osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.25);
        } catch(e) {}
    }

    function computeEAR(landmarks, topIdx, bottomIdx, leftIdx, rightIdx) {
        const top = landmarks[topIdx];
        const bottom = landmarks[bottomIdx];
        const left = landmarks[leftIdx];
        const right = landmarks[rightIdx];
        const vDist = Math.hypot(top.x - bottom.x, top.y - bottom.y);
        const hDist = Math.hypot(left.x - right.x, left.y - right.y);
        if (hDist === 0) return 0.25;
        return vDist / hDist;
    }

    async function startFaceAuthentication() {
        isAuthenticating = false;
        eyesClosed = false;
        faceOval.className = 'face-oval';
        livenessPill.className = 'liveness-pill searching';
        livenessIcon.textContent = '👤';
        livenessText.textContent = 'Position face inside oval';

        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
                audio: false
            });
            faceVideo.srcObject = cameraStream;
            await faceVideo.play();
        } catch (err) {
            console.error("Camera access error:", err);
            alert("Camera access is needed for Aadhaar Face Authentication. Please allow camera permissions.");
            showScreen(verifyScreen);
            return;
        }

        initFaceMesh();
    }

    function stopCamera() {
        if (cameraInstance) {
            try { cameraInstance.stop(); } catch(e) {}
            cameraInstance = null;
        }
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        faceVideo.srcObject = null;
    }

    function initFaceMesh() {
        if (typeof FaceMesh === 'undefined') {
            console.warn("MediaPipe FaceMesh not loaded from CDN. Manual capture available.");
            livenessPill.className = 'liveness-pill blink';
            livenessText.textContent = 'Camera Ready - Click Manual Capture';
            return;
        }

        try {
            faceMesh = new FaceMesh({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
            });

            faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            faceMesh.onResults(onFaceMeshResults);

            if (typeof Camera !== 'undefined') {
                cameraInstance = new Camera(faceVideo, {
                    onFrame: async () => {
                        if (cameraStream && !isAuthenticating) {
                            try { await faceMesh.send({ image: faceVideo }); } catch(e) {}
                        }
                    },
                    width: 640,
                    height: 480
                });
                cameraInstance.start();
            } else {
                const processFrame = async () => {
                    if (cameraStream && !isAuthenticating) {
                        try { await faceMesh.send({ image: faceVideo }); } catch(e) {}
                        requestAnimationFrame(processFrame);
                    }
                };
                requestAnimationFrame(processFrame);
            }
        } catch(e) {
            console.error("FaceMesh initialization error:", e);
        }
    }

    function onFaceMeshResults(results) {
        if (isAuthenticating) return;

        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            faceOval.className = 'face-oval';
            livenessPill.className = 'liveness-pill searching';
            livenessIcon.textContent = '👤';
            livenessText.textContent = 'Position face inside oval';
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];
        faceOval.className = 'face-oval aligned blink-prompt';
        livenessPill.className = 'liveness-pill blink';
        livenessIcon.textContent = '👁️';
        livenessText.textContent = 'Please BLINK your eyes now';

        // Eye Aspect Ratio for blink detection
        const leftEAR = computeEAR(landmarks, 386, 374, 362, 263);
        const rightEAR = computeEAR(landmarks, 159, 145, 33, 133);
        const avgEAR = (leftEAR + rightEAR) / 2;

        if (avgEAR < 0.17) {
            if (!eyesClosed) {
                eyesClosed = true;
                eyesClosedStartTime = Date.now();
            }
        } else if (avgEAR >= 0.22 && eyesClosed) {
            const duration = Date.now() - eyesClosedStartTime;
            eyesClosed = false;
            // Valid natural human blink is between 80ms and 800ms
            if (duration >= 80 && duration <= 800) {
                captureAndAuthenticateFace("Blink Confirmed! Authenticating...");
            }
        }
    }

    async function captureAndAuthenticateFace(statusMessage = "Authenticating...") {
        if (isAuthenticating) return;
        isAuthenticating = true;

        playCaptureChime();

        faceOval.className = 'face-oval success';
        livenessPill.className = 'liveness-pill success';
        livenessIcon.textContent = '✓';
        livenessText.textContent = statusMessage;

        // Keep face image visible in oval and pause video cleanly without crashing WebAssembly
        try { faceVideo.pause(); } catch(e) {}

        // Capture frame to 320x240 canvas for fast, lightweight transfer (~25KB)
        faceCanvas.width = 320;
        faceCanvas.height = 240;
        const ctx = faceCanvas.getContext('2d');
        // Un-mirror snapshot for correct orientation
        ctx.translate(320, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(faceVideo, 0, 0, 320, 240);
        const base64Img = faceCanvas.toDataURL('image/jpeg', 0.85);

        try {
            const res = await fetch('/api/beneficiaries/verify-face', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    beneficiary_id: currentBeneficiary.beneficiary_id,
                    image_base64: base64Img
                })
            });

            const data = await res.json();
            if (!res.ok) {
                let msg = 'Face verification failed';
                if (data && data.detail) {
                    msg = Array.isArray(data.detail) ? data.detail[0].msg : data.detail;
                }
                throw new Error(msg);
            }

            // Stop camera ONLY after server response
            stopCamera();

            // Populate details & photo
            detPhoto.src = data.photo_url || base64Img;
            detName.textContent = currentBeneficiary.name;
            detId.textContent = currentBeneficiary.beneficiary_id;
            detMembers.textContent = currentBeneficiary.family_members;
            detMonthly.textContent = currentBeneficiary.monthly_entitlement;
            detCollected.textContent = currentBeneficiary.collected_quantity;
            detRemaining.textContent = currentBeneficiary.remaining_quantity;

            showScreen(detailsScreen);

            // Wait 2.5 seconds then start dispensing
            setTimeout(() => startDispensing(currentBeneficiary.beneficiary_id), 2500);

        } catch (err) {
            console.error("Biometric verification error:", err);
            stopCamera();
            alert(err.message || "Face not Matched");
            showScreen(verifyScreen);
        }
    }

    // Manual Capture Fallback
    manualSnapBtn.addEventListener('click', () => {
        captureAndAuthenticateFace("Manual Capture! Authenticating...");
    });

    // Face Auth Cancel Button
    faceCancelBtn.addEventListener('click', () => {
        stopCamera();
        showScreen(verifyScreen);
    });

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

            let data;
            try {
                data = await res.json();
            } catch (e) {
                throw new Error("Invalid response from server.");
            }

            if(!res.ok) {
                let msg = 'Verification failed';
                if (data && data.detail) {
                    msg = Array.isArray(data.detail) ? data.detail[0].msg : data.detail;
                }
                throw new Error(msg);
            }

            currentBeneficiary = data;
            
            // Transition to Aadhaar Face Liveness Authentication
            faceBenInfo.innerHTML = `Beneficiary: <strong>${data.name}</strong> (${data.beneficiary_id})`;
            showScreen(faceAuthScreen);
            startFaceAuthentication();

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
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
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
        compDatetime.textContent = new Date().toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase();

        showScreen(completeScreen);
        if(ws) ws.close();
    }

    resetBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/dispense/reset', { method: 'POST' });
        } catch(e) {}

        idInput.value = '';
        errorMsg.classList.add('hidden');
        currentBeneficiary = null;
        currentJobId = null;
        showScreen(verifyScreen);
    });
});
