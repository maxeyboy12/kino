document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const userInput = document.getElementById('userInput');
    const aiOutput = document.getElementById('aiOutput');
    const logButton = document.getElementById('logButton');
    const logModal = document.getElementById('logModal');
    const closeModalButton = document.querySelector('.close-button');
    const logContainer = document.getElementById('logContainer');

    // --- CONFIGURATION & STATE ---
    const DEBOUNCE_MS = 250; // Faster debounce for a "live" feel
    const WORKER_URL = 'https://lnkino-api.maxzitek8.workers.dev';
    let debounceTimer;
    let abortController = new AbortController(); // To cancel in-flight requests
    let apiCallLog = []; // Array to store log data

    // --- EVENT LISTENERS ---
    userInput.addEventListener('input', handleUserInput);
    logButton.addEventListener('click', openModal);
    closeModalButton.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target == logModal) closeModal();
    });

    // --- CORE FUNCTIONS ---
    function handleUserInput() {
        // Abort any request that is currently in progress.
        abortController.abort();
        abortController = new AbortController(); // Create a new controller for the next request.

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(triggerAI, DEBOUNCE_MS);
    }

    async function triggerAI() {
        const fullText = userInput.value;
        let lockedText = "";
        let activeText = fullText;
        const lastParagraphIndex = fullText.lastIndexOf('\n\n');

        if (lastParagraphIndex !== -1) {
            lockedText = fullText.substring(0, lastParagraphIndex).trim();
            activeText = fullText.substring(lastParagraphIndex).trim();
        }

        if (!activeText) {
            aiOutput.innerHTML = '';
            if (lockedText) renderLockedContent(lockedText);
            return;
        };

        // --- RENDER UI FOR STREAMING ---
        aiOutput.innerHTML = ''; // Clear previous output
        if (lockedText) renderLockedContent(lockedText);
        const activeElement = document.createElement('div');
        aiOutput.appendChild(activeElement);
        let fullResponse = "";

        try {
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lockedText, activeText }),
                signal: abortController.signal, // Pass the abort signal
            });

            if (!response.ok) throw new Error(`Worker error: ${response.statusText}`);
            if (!response.body) throw new Error("Response body is missing.");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    logApiCall(lockedText, activeText, fullResponse); // Log the final result
                    break;
                }
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6);
                        if (data.trim() === '[DONE]') continue;
                        try {
                            const json = JSON.parse(data);
                            const token = json.choices[0]?.delta?.content || "";
                            if (token) {
                                fullResponse += token;
                                activeElement.textContent = fullResponse; // Update UI token by token
                            }
                        } catch (e) {
                            // Ignore parsing errors on partial data chunks
                        }
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Fetch aborted.');
                activeElement.textContent = '...';
            } else {
                console.error('Error calling AI:', error);
                activeElement.textContent = "Error connecting to the assistant.";
            }
        }
    }

    function renderLockedContent(lockedContent) {
        const paragraphs = lockedContent.split('\n\n');
        paragraphs.forEach(pText => {
            if (pText.trim()) {
                const pElement = document.createElement('div');
                pElement.className = 'locked-paragraph';
                pElement.textContent = pText;
                aiOutput.appendChild(pElement);
            }
        });
    }

    // --- LOGGING & MODAL FUNCTIONS ---
    function logApiCall(locked, active, response) {
        const callData = {
            timestamp: new Date(),
            input: `---LOCKED---\n${locked}\n---ACTIVE---\n${active}`,
            output: response,
        };
        apiCallLog.unshift(callData); // Add to the beginning of the array
    }

    function openModal() {
        renderLog();
        logModal.style.display = 'block';
    }

    function closeModal() {
        logModal.style.display = 'none';
    }

    function renderLog() {
        logContainer.innerHTML = '';
        const totalCalls = apiCallLog.length;
        document.getElementById('totalCalls').textContent = totalCalls;

        if (totalCalls === 0) {
            logContainer.innerHTML = '<p>No API calls made yet in this session.</p>';
            return;
        }

        apiCallLog.forEach((call, index) => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'log-entry';
            entryDiv.innerHTML = `
                <div class="log-entry-header">
                    <strong>Call #${totalCalls - index}</strong> | 
                    ${call.timestamp.toLocaleTimeString()}
                </div>
                <div class="log-entry-body">
                    <strong>Input Sent:</strong>
                    <pre><code>${call.input}</code></pre>
                    <hr>
                    <strong>Output Received:</strong>
                    <pre><code>${call.output}</code></pre>
                </div>
            `;
            logContainer.appendChild(entryDiv);
        });
    }
});