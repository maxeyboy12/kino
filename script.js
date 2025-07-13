document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const userInput = document.getElementById('userInput');
    const aiOutput = document.getElementById('aiOutput');
    const logButton = document.getElementById('logButton');
    const logModal = document.getElementById('logModal');
    const closeModalButton = document.querySelector('.close-button');
    const logContainer = document.getElementById('logContainer');

    // --- CONFIGURATION & STATE ---
    const DEBOUNCE_MS = 800;
    const WORKER_URL = 'https://lnkino-api.maxzitek8.workers.dev';
    const COSTS = { // Per 1 Million Tokens
        INPUT: 0.15,
        CACHED_INPUT: 0.075, // Note: We can't know if it's cached, so we'll use the standard input cost.
        OUTPUT: 0.60,
    };
    let debounceTimer;
    let apiCallLog = []; // Array to store log data

    // --- EVENT LISTENERS ---
    userInput.addEventListener('input', handleUserInput);
    logButton.addEventListener('click', openModal);
    closeModalButton.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target == logModal) {
            closeModal();
        }
    });

    // --- CORE FUNCTIONS ---
    function handleUserInput() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(triggerAI, DEBOUNCE_MS);

        const lastChar = userInput.value.slice(-1);
        if (['.', '?', '!'].includes(lastChar)) {
            clearTimeout(debounceTimer);
            triggerAI();
        }
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
        
        if (!activeText) return;

        try {
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lockedText, activeText }),
            });

            if (!response.ok) throw new Error(`Worker returned an error: ${response.statusText}`);
            
            const data = await response.json();
            
            // Log the call and update UI
            logApiCall(lockedText, activeText, data.usage, data.aiResponse);
            updateAIOutput(lockedText, data.aiResponse);

        } catch (error) {
            console.error('Error calling AI:', error);
            aiOutput.textContent = "Error connecting to the assistant.";
        }
    }

    function updateAIOutput(lockedContent, activeContent) {
        aiOutput.innerHTML = '';
        if (lockedContent) {
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
        const activeElement = document.createElement('div');
        activeElement.textContent = activeContent;
        aiOutput.appendChild(activeElement);
    }
    
    // --- LOGGING & MODAL FUNCTIONS ---
    function logApiCall(locked, active, usage, response) {
        const callData = {
            timestamp: new Date(),
            input: `---LOCKED---\n${locked}\n---ACTIVE---\n${active}`,
            output: response,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            cost: calculateCost(usage.prompt_tokens, usage.completion_tokens)
        };
        apiCallLog.unshift(callData); // Add to the beginning of the array
    }

    function calculateCost(promptTokens, completionTokens) {
        const inputCost = (promptTokens / 1_000_000) * COSTS.INPUT;
        const outputCost = (completionTokens / 1_000_000) * COSTS.OUTPUT;
        return inputCost + outputCost;
    }

    function openModal() {
        renderLog();
        logModal.style.display = 'block';
    }

    function closeModal() {
        logModal.style.display = 'none';
    }
    
    function renderLog() {
        // Clear previous logs
        logContainer.innerHTML = '';
        
        let totalCalls = apiCallLog.length;
        let totalTokens = apiCallLog.reduce((sum, call) => sum + call.totalTokens, 0);
        let totalCost = apiCallLog.reduce((sum, call) => sum + call.cost, 0);

        // Update summary stats
        document.getElementById('totalCalls').textContent = totalCalls;
        document.getElementById('totalTokens').textContent = totalTokens;
        document.getElementById('sessionCost').textContent = totalCost.toFixed(7);

        if (totalCalls === 0) {
            logContainer.innerHTML = '<p>No API calls made yet in this session.</p>';
            return;
        }

        // Render each log entry
        apiCallLog.forEach((call, index) => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'log-entry';
            entryDiv.innerHTML = `
                <div class="log-entry-header">
                    <strong>Call #${totalCalls - index}</strong> | 
                    ${call.timestamp.toLocaleTimeString()} | 
                    Total Tokens: ${call.totalTokens} | 
                    Cost: $${call.cost.toFixed(7)}
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