// Global variables
let teams = {};
let currentTeam = '';
let tempPlayers = [];
let teamQuarterClocks = {};
let quarterTimerInterval = null;
let quarterStartTime = null;
let currentQuarter = 'Q1';
let goals = [];
let soundEnabled = true;
let updateInterval = null;
let editingGoalIndex = -1;
let pendingImportData = null;
let controlsCollapsed = false;

// Audio context for notification sound
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioContext = null;

// Quarter clock persistence
let quarterClockState = {
    isRunning: false,
    startTime: null,
    elapsedTime: 0
};

function playDing() {
    if (!soundEnabled) return;
    
    if (!audioContext) {
        audioContext = new AudioContext();
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 880; // A5 note
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    document.getElementById('sound-status').textContent = soundEnabled ? '🔊' : '🔇';
    localStorage.setItem('soundEnabled', soundEnabled);
}

function toggleControls() {
    const content = document.getElementById('collapsible-content');
    const toggle = document.getElementById('collapse-toggle');
    
    controlsCollapsed = !controlsCollapsed;
    
    if (controlsCollapsed) {
        content.classList.add('collapsed');
        toggle.textContent = '🔽';
    } else {
        content.classList.remove('collapsed');
        toggle.textContent = '🔼';
    }
    
    localStorage.setItem('controlsCollapsed', controlsCollapsed);
}

// Initialize quarter buttons
function initializeQuarterButtons() {
    document.querySelectorAll('.quarter-button').forEach(button => {
        button.addEventListener('click', () => {
            // Save current quarter's time
            if (quarterTimerInterval) {
                stopQuarterClock();
            }
            
            document.querySelectorAll('.quarter-button').forEach(btn =>
                btn.classList.remove('active')
            );
            button.classList.add('active');
            
            currentQuarter = button.getAttribute('data-quarter');
            updateQuarterClock();
            saveQuarterClockState();
        });
    });
}

function startQuarterClock() {
    if (quarterTimerInterval || !currentTeam) return;
    
    const currentClocks = getCurrentQuarterClocks();
    const now = Date.now();
    
    quarterStartTime = now - (currentClocks[currentQuarter] * 1000);
    quarterTimerInterval = setInterval(updateQuarterClock, 100);
    
    // Update persistent state
    quarterClockState.isRunning = true;
    quarterClockState.startTime = quarterStartTime;
    quarterClockState.elapsedTime = currentClocks[currentQuarter];
    saveQuarterClockState();
    
    // Start player timers for those on field
    teams[currentTeam]?.forEach(player => {
        if (player.onField && !player.sessionStart) {
            player.sessionStart = now;
            player.lastTimestamp = now;
        }
    });
    
    saveTeams();
}

function stopQuarterClock() {
    if (quarterTimerInterval) {
        clearInterval(quarterTimerInterval);
        quarterTimerInterval = null;
        
        if (quarterStartTime && currentTeam) {
            const currentClocks = getCurrentQuarterClocks();
            currentClocks[currentQuarter] = Math.floor((Date.now() - quarterStartTime) / 1000);
            saveTeamQuarterClocks();
        }
    }
    
    // Update persistent state
    quarterClockState.isRunning = false;
    quarterClockState.startTime = null;
    const currentClocks = getCurrentQuarterClocks();
    quarterClockState.elapsedTime = currentClocks[currentQuarter];
    saveQuarterClockState();
    
    // Log all player times for those on field
    const now = Date.now();
    teams[currentTeam]?.forEach(player => {
        if (player.onField && player.sessionStart) {
            const sessionTime = Math.floor((now - player.sessionStart) / 1000);
            player.totalTime += sessionTime;
            
            // Add to rotation log
            player.rotationLog.push({
                in: new Date(player.sessionStart).toLocaleTimeString(),
                out: new Date(now).toLocaleTimeString(),
                duration: formatTime(sessionTime),
                quarter: currentQuarter
            });
            
            // Reset session tracking but keep on field
            player.sessionStart = null;
            player.lastTimestamp = null;
        }
    });
    
    saveTeams();
    updatePlayerDisplay();
    renderRotationLog();
}

function updateQuarterClock() {
    let seconds;
    if (quarterTimerInterval && quarterStartTime && currentTeam) {
        seconds = Math.floor((Date.now() - quarterStartTime) / 1000);
        const currentClocks = getCurrentQuarterClocks();
        currentClocks[currentQuarter] = seconds;
    } else {
        const currentClocks = getCurrentQuarterClocks();
        seconds = currentClocks[currentQuarter];
    }
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('quarter-clock').textContent = 
        `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getCurrentQuarterClocks() {
    if (!currentTeam) return { Q1: 0, Q2: 0, Q3: 0, Q4: 0, OT: 0 };
    
    if (!teamQuarterClocks[currentTeam]) {
        teamQuarterClocks[currentTeam] = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, OT: 0 };
    }
    return teamQuarterClocks[currentTeam];
}

function saveQuarterClockState() {
    if (!currentTeam) return;
    
    const stateToSave = {
        ...quarterClockState,
        team: currentTeam,
        quarter: currentQuarter
    };
    localStorage.setItem('quarterClockState', JSON.stringify(stateToSave));
}

function loadQuarterClockState() {
    try {
        const saved = localStorage.getItem('quarterClockState');
        if (saved) {
            const state = JSON.parse(saved);
            if (state.team === currentTeam && state.isRunning) {
                quarterClockState = state;
                
                // Restore the running clock
                const now = Date.now();
                const timeSinceStart = Math.floor((now - state.startTime) / 1000);
                const currentClocks = getCurrentQuarterClocks();
                currentClocks[state.quarter] = timeSinceStart;
                
                quarterStartTime = state.startTime;
                quarterTimerInterval = setInterval(updateQuarterClock, 100);
                
                // Set active quarter
                currentQuarter = state.quarter;
                document.querySelectorAll('.quarter-button').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-quarter') === currentQuarter);
                });
            }
        }
    } catch (e) {
        console.error('Error loading quarter clock state:', e);
    }
}

function createTeam() {
    const teamName = prompt("Enter team name:");
    if (!teamName || teamName.trim() === '') return;

    teams[teamName] = [];
    updateTeamOptions();
    saveTeams();
}

function updateTeamOptions() {
    const teamSelect = document.getElementById('team-select');
    if (!teamSelect) return;
    
    const currentValue = teamSelect.value;
    teamSelect.innerHTML = '<option value="">Select Team</option>';
    Object.keys(teams).forEach(team => {
        const option = document.createElement('option');
        option.value = team;
        option.textContent = team;
        if (team === currentValue) {
            option.selected = true;
        }
        teamSelect.appendChild(option);
    });
}

function loadSelectedTeam() {
    currentTeam = document.getElementById('team-select').value;
    const header = document.getElementById('team-title');
    header.textContent = currentTeam ? `${currentTeam} Time Tracker` : 'Soccer Time Tracker';
    
    // Save selected team to localStorage
    if (currentTeam) {
        localStorage.setItem('selectedTeam', currentTeam);
        renderPlayerCards();
        updateCaptainOptions();
        renderRotationLog();
        renderGoalsLog();
        updateScoreDisplay();
        updateQuarterClock();
        loadQuarterClockState();
        startUpdateInterval();
    } else {
        localStorage.removeItem('selectedTeam');
        document.getElementById('players').innerHTML = '';
        document.getElementById('quarter-clock').textContent = '0:00';
        stopUpdateInterval();
        
        // Clear quarter clock state
        if (quarterTimerInterval) {
            clearInterval(quarterTimerInterval);
            quarterTimerInterval = null;
        }
        localStorage.removeItem('quarterClockState');
    }
}

function renderPlayerCards() {
    if (!currentTeam) return;
    
    const container = document.getElementById('players');
    container.innerHTML = '';
    
    teams[currentTeam].forEach((player, index) => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.id = `player-${index}`;
        card.onclick = () => toggleField(index);
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'player-name';
        nameDiv.textContent = player.name;
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'player-time';
        timeDiv.id = `time-${index}`;
        
        card.appendChild(nameDiv);
        card.appendChild(timeDiv);
        container.appendChild(card);
    });
    
    updatePlayerDisplay();
}

function updatePlayerDisplay() {
    if (!currentTeam) return;
    
    const now = Date.now();
    const rotationMinutes = parseInt(document.getElementById('rotation').value) || 5;
    const rotationSeconds = rotationMinutes * 60;
    const captain = document.getElementById('captain-select').value;
    
    teams[currentTeam].forEach((player, index) => {
        const card = document.getElementById(`player-${index}`);
        const timeDiv = document.getElementById(`time-${index}`);
        
        if (!card || !timeDiv) return;
        
        let displayTime = player.totalTime;
        let sessionTime = 0;
        
        if (player.onField && player.sessionStart) {
            sessionTime = Math.floor((now - player.sessionStart) / 1000);
            displayTime += sessionTime;
        }
        
        timeDiv.textContent = formatTime(displayTime);
        
        // Reset classes
        card.className = 'player-card';
        
        // Remove existing icons
        const existingAlert = card.querySelector('.alert-icon');
        if (existingAlert) existingAlert.remove();
        
        // Add appropriate class based on state
        if (player.onField) {
            card.classList.add('on-field');
            
            // Warning and alert states for on-field players
            if (sessionTime >= rotationSeconds * 0.8) {
                card.classList.add('warning');
            }
            if (sessionTime >= rotationSeconds) {
                card.classList.add('alert');
                const alertIcon = document.createElement('div');
                alertIcon.className = 'alert-icon';
                alertIcon.textContent = '🔔';
                card.appendChild(alertIcon);
                playDing();
            }
        } else if (displayTime === 0) {
            card.classList.add('not-played');
        }
        
        // Captain badge
        const existingBadge = card.querySelector('.captain-badge');
        if (existingBadge) existingBadge.remove();
        
        if (captain === player.name) {
            const badge = document.createElement('div');
            badge.className = 'captain-badge';
            badge.textContent = '👑';
            card.appendChild(badge);
        }
    });
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function toggleField(playerIndex) {
    if (!currentTeam) return;
    
    const player = teams[currentTeam][playerIndex];
    const now = Date.now();
    
    if (player.onField) {
        // Player coming off field - remove alert and stop sounds
        const card = document.getElementById(`player-${playerIndex}`);
        const alertIcon = card?.querySelector('.alert-icon');
        if (alertIcon) alertIcon.remove();
        
        if (player.sessionStart) {
            const sessionTime = Math.floor((now - player.sessionStart) / 1000);
            player.totalTime += sessionTime;
            
            // Add to rotation log
            player.rotationLog.push({
                in: new Date(player.sessionStart).toLocaleTimeString(),
                out: new Date(now).toLocaleTimeString(),
                duration: formatTime(sessionTime),
                quarter: currentQuarter
            });
            
            player.sessionStart = null;
            player.lastTimestamp = null;
        }
        player.onField = false;
    } else {
        // Player going on field
        player.onField = true;
        // Only start session timer if quarter clock is running
        if (quarterTimerInterval) {
            player.sessionStart = now;
            player.lastTimestamp = now;
        } else {
            player.sessionStart = null;
            player.lastTimestamp = null;
        }
    }
    
    saveTeams();
    updatePlayerDisplay();
    renderRotationLog();
}

function startUpdateInterval() {
    if (updateInterval) return;
    updateInterval = setInterval(updatePlayerDisplay, 1000);
}

function stopUpdateInterval() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

function updateCaptainOptions() {
    if (!currentTeam) return;
    
    const select = document.getElementById('captain-select');
    const currentValue = select.value;
    select.innerHTML = '<option value="">None</option>';
    
    teams[currentTeam].forEach(player => {
        const option = document.createElement('option');
        option.value = player.name;
        option.textContent = player.name;
        if (player.name === currentValue) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function showManagePlayersModal() {
    if (!currentTeam) {
        alert('Please select a team first');
        return;
    }
    
    tempPlayers = JSON.parse(JSON.stringify(teams[currentTeam]));
    renderTempPlayers();
    document.getElementById('manage-modal').style.display = 'block';
}

function renderTempPlayers() {
    const container = document.getElementById('player-list');
    container.innerHTML = '';
    
    tempPlayers.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = player.name;
        input.onchange = (e) => tempPlayers[index].name = e.target.value;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑 Delete';
        deleteBtn.onclick = () => {
            tempPlayers.splice(index, 1);
            renderTempPlayers();
        };
        
        item.appendChild(input);
        item.appendChild(deleteBtn);
        container.appendChild(item);
    });
}

function addPlayerFromModal() {
    const name = document.getElementById('new-player-name').value.trim();
    if (!name) return;
    
    tempPlayers.push({
        name: name,
        totalTime: 0,
        onField: false,
        sessionStart: null,
        lastTimestamp: null,
        rotationLog: []
    });
    
    document.getElementById('new-player-name').value = '';
    renderTempPlayers();
}

function savePlayersFromModal() {
    // Filter out empty names
    tempPlayers = tempPlayers.filter(player => player.name.trim() !== '');
    teams[currentTeam] = tempPlayers;
    
    saveTeams();
    renderPlayerCards();
    updateCaptainOptions();
    closeManageModal();
}

function closeManageModal() {
    document.getElementById('manage-modal').style.display = 'none';
}

function showGoalModal() {
    if (!currentTeam) {
        alert('Please select a team first');
        return;
    }
    
    const select = document.getElementById('goal-scorer');
    select.innerHTML = '<option value="">Select Player</option>';
    
    teams[currentTeam].forEach(player => {
        const option = document.createElement('option');
        option.value = player.name;
        option.textContent = player.name;
        select.appendChild(option);
    });
    
    // Reset radio buttons and show/hide player selection
    document.querySelector('input[name="goal-team"][value="team"]').checked = true;
    updateGoalScorerVisibility();
    
    document.getElementById('goal-modal').style.display = 'block';
}

function updateGoalScorerVisibility() {
    const goalTeam = document.querySelector('input[name="goal-team"]:checked').value;
    const scorerSelect = document.getElementById('goal-scorer');
    const scorerContainer = scorerSelect.parentElement;
    
    if (goalTeam === 'other') {
        scorerContainer.style.display = 'none';
        scorerSelect.value = '';
    } else {
        scorerContainer.style.display = 'block';
    }
}

function closeGoalModal() {
    document.getElementById('goal-modal').style.display = 'none';
}

function recordGoal() {
    const goalTeam = document.querySelector('input[name="goal-team"]:checked').value;
    let scorer = document.getElementById('goal-scorer').value;
    
    // For team goals, require player selection
    if (goalTeam === 'team' && !scorer) {
        alert('Please select a player');
        return;
    }
    
    // For other team goals, use generic scorer name
    if (goalTeam === 'other') {
        scorer = 'Other Team Player';
    }
    
    const goal = {
        scorer: scorer,
        team: goalTeam,
        time: new Date().toLocaleTimeString(),
        quarter: currentQuarter,
        timestamp: Date.now()
    };
    
    if (!goals[currentTeam]) {
        goals[currentTeam] = [];
    }
    goals[currentTeam].push(goal);
    
    saveGoals();
    updateScoreDisplay();
    renderGoalsLog();
    closeGoalModal();
}

function showManageGoalsModal() {
    if (!currentTeam) {
        alert('Please select a team first');
        return;
    }
    
    renderManageGoalsList();
    document.getElementById('manage-goals-modal').style.display = 'block';
}

function renderManageGoalsList() {
    const container = document.getElementById('goals-list');
    container.innerHTML = '';
    
    const teamGoals = goals[currentTeam] || [];
    
    if (teamGoals.length === 0) {
        container.innerHTML = '<p>No goals recorded yet.</p>';
        return;
    }
    
    teamGoals.forEach((goal, index) => {
        const item = document.createElement('div');
        item.className = 'goal-item';
        
        const info = document.createElement('div');
        info.className = 'goal-info';
        const teamName = goal.team === 'team' ? currentTeam : 'Other Team';
        info.innerHTML = `
            <strong>${goal.scorer}</strong> (${teamName})<br>
            <small>${goal.quarter} - ${goal.time}</small>
        `;
        
        const actions = document.createElement('div');
        actions.className = 'goal-actions';
        
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️ Edit';
        editBtn.className = 'edit-button';
        editBtn.onclick = () => editGoal(index);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑 Delete';
        deleteBtn.className = 'delete-button';
        deleteBtn.onclick = () => deleteGoal(index);
        
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        
        item.appendChild(info);
        item.appendChild(actions);
        container.appendChild(item);
    });
}

function editGoal(index) {
    editingGoalIndex = index;
    const goal = goals[currentTeam][index];
    
    // Populate edit modal
    const select = document.getElementById('edit-goal-scorer');
    select.innerHTML = '<option value="">Select Player</option>';
    
    teams[currentTeam].forEach(player => {
        const option = document.createElement('option');
        option.value = player.name;
        option.textContent = player.name;
        if (player.name === goal.scorer) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    // Set radio buttons
    if (goal.team === 'team') {
        document.getElementById('edit-team-radio').checked = true;
    } else {
        document.getElementById('edit-other-radio').checked = true;
    }
    
    // Update visibility based on team selection
    updateEditGoalScorerVisibility();
    
    document.getElementById('edit-goal-modal').style.display = 'block';
}

function updateEditGoalScorerVisibility() {
    const goalTeam = document.querySelector('input[name="edit-goal-team"]:checked').value;
    const scorerSelect = document.getElementById('edit-goal-scorer');
    const scorerContainer = scorerSelect.parentElement;
    
    if (goalTeam === 'other') {
        scorerContainer.style.display = 'none';
        scorerSelect.value = '';
    } else {
        scorerContainer.style.display = 'block';
    }
}

function saveEditedGoal() {
    const goalTeam = document.querySelector('input[name="edit-goal-team"]:checked').value;
    let scorer = document.getElementById('edit-goal-scorer').value;
    
    // For team goals, require player selection
    if (goalTeam === 'team' && !scorer) {
        alert('Please select a player');
        return;
    }
    
    // For other team goals, use generic scorer name
    if (goalTeam === 'other') {
        scorer = 'Other Team Player';
    }
    
    if (editingGoalIndex >= 0) {
        goals[currentTeam][editingGoalIndex].scorer = scorer;
        goals[currentTeam][editingGoalIndex].team = goalTeam;
        
        saveGoals();
        updateScoreDisplay();
        renderGoalsLog();
        renderManageGoalsList();
        closeEditGoalModal();
    }
}

function closeEditGoalModal() {
    document.getElementById('edit-goal-modal').style.display = 'none';
    editingGoalIndex = -1;
}

function deleteGoal(index) {
    if (confirm('Are you sure you want to delete this goal?')) {
        goals[currentTeam].splice(index, 1);
        saveGoals();
        updateScoreDisplay();
        renderGoalsLog();
        renderManageGoalsList();
    }
}

function closeManageGoalsModal() {
    document.getElementById('manage-goals-modal').style.display = 'none';
}

function updateScoreDisplay() {
    if (!currentTeam) return;
    
    const teamGoals = goals[currentTeam] || [];
    const teamScore = teamGoals.filter(goal => goal.team === 'team').length;
    const otherScore = teamGoals.filter(goal => goal.team === 'other').length;
    
    document.getElementById('team-score').textContent = `${currentTeam}: ${teamScore}`;
    document.getElementById('other-score').textContent = `Other: ${otherScore}`;
}

function renderRotationLog() {
    if (!currentTeam) return;
    
    const container = document.getElementById('rotation-log');
    container.innerHTML = '';
    
    let allRotations = [];
    teams[currentTeam].forEach(player => {
        player.rotationLog.forEach(log => {
            allRotations.push({
                ...log,
                player: player.name
            });
        });
    });
    
    allRotations.sort((a, b) => new Date('1970/01/01 ' + a.in) - new Date('1970/01/01 ' + b.in));
    
    if (allRotations.length === 0) {
        container.innerHTML = '<p>No rotations recorded yet.</p>';
        return;
    }
    
    const table = document.createElement('table');
    table.innerHTML = `
        <tr>
            <th>Player</th>
            <th>Quarter</th>
            <th>In</th>
            <th>Out</th>
            <th>Duration</th>
        </tr>
    `;
    
    allRotations.forEach(rotation => {
        const row = table.insertRow();
        row.innerHTML = `
            <td>${rotation.player}</td>
            <td>${rotation.quarter}</td>
            <td>${rotation.in}</td>
            <td>${rotation.out}</td>
            <td>${rotation.duration}</td>
        `;
    });
    
    container.appendChild(table);
}

function renderGoalsLog() {
    if (!currentTeam) return;
    
    const container = document.getElementById('goals-log');
    container.innerHTML = '';
    
    const teamGoals = goals[currentTeam] || [];
    
    if (teamGoals.length === 0) {
        container.innerHTML = '<p>No goals recorded yet.</p>';
        return;
    }
    
    const table = document.createElement('table');
    table.innerHTML = `
        <tr>
            <th>Scorer</th>
            <th>Team</th>
            <th>Quarter</th>
            <th>Time</th>
        </tr>
    `;
    
    teamGoals.forEach(goal => {
        const row = table.insertRow();
        const teamName = goal.team === 'team' ? currentTeam : 'Other Team';
        row.innerHTML = `
            <td>${goal.scorer}</td>
            <td>${teamName}</td>
            <td>${goal.quarter}</td>
            <td>${goal.time}</td>
        `;
    });
    
    container.appendChild(table);
}

function showResetWarning() {
    if (!currentTeam) {
        alert('Please select a team first');
        return;
    }
    document.getElementById('reset-warning-modal').style.display = 'block';
}

function closeResetWarning() {
    document.getElementById('reset-warning-modal').style.display = 'none';
}

function confirmReset() {
    if (!currentTeam) return;
    
    // Reset all player times and logs
    teams[currentTeam].forEach(player => {
        player.totalTime = 0;
        player.onField = false;
        player.sessionStart = null;
        player.lastTimestamp = null;
        player.rotationLog = [];
    });
    
    // Reset goals
    if (goals[currentTeam]) {
        goals[currentTeam] = [];
    }
    
    // Reset quarter clocks for this team
    if (teamQuarterClocks[currentTeam]) {
        teamQuarterClocks[currentTeam] = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, OT: 0 };
    }
    
    // Stop any running timers
    if (quarterTimerInterval) {
        clearInterval(quarterTimerInterval);
        quarterTimerInterval = null;
    }
    
    // Clear persistent state
    quarterClockState = { isRunning: false, startTime: null, elapsedTime: 0 };
    localStorage.removeItem('quarterClockState');
    
    saveTeams();
    saveGoals();
    saveTeamQuarterClocks();
    updatePlayerDisplay();
    renderRotationLog();
    renderGoalsLog();
    updateScoreDisplay();
    updateQuarterClock();
    closeResetWarning();
}

function showShareModal() {
    if (!currentTeam) {
        alert('Please select a team first');
        return;
    }
    
    // Reset checkboxes to default
    document.getElementById('share-times').checked = true;
    document.getElementById('share-rotation').checked = true;
    document.getElementById('share-goals').checked = true;
    document.getElementById('share-quarters').checked = true;
    
    // Hide URL container initially
    document.getElementById('share-url-container').style.display = 'none';
    
    document.getElementById('share-modal').style.display = 'block';
}

function generateShareUrl() {
    if (!currentTeam) return;
    
    const shareData = {
        teamName: currentTeam,
        team: teams[currentTeam] // Players always included
    };
    
    // Add optional data based on selections
    if (document.getElementById('share-times').checked) {
        // Include player times but clear session data for sharing
        shareData.team = shareData.team.map(player => ({
            ...player,
            sessionStart: null,
            lastTimestamp: null
        }));
    } else {
        // Remove times but keep player structure
        shareData.team = shareData.team.map(player => ({
            name: player.name,
            totalTime: 0,
            onField: false,
            sessionStart: null,
            lastTimestamp: null,
            rotationLog: []
        }));
    }
    
    if (document.getElementById('share-rotation').checked) {
        // Rotation log is already included in team data
    } else {
        // Clear rotation logs
        shareData.team = shareData.team.map(player => ({
            ...player,
            rotationLog: []
        }));
    }
    
    if (document.getElementById('share-goals').checked) {
        shareData.goals = goals[currentTeam] || [];
    }
    
    if (document.getElementById('share-quarters').checked) {
        shareData.quarterClocks = teamQuarterClocks[currentTeam] || { Q1: 0, Q2: 0, Q3: 0, Q4: 0, OT: 0 };
    }
    
    // Create compressed share URL
    const compressed = compressData(JSON.stringify(shareData));
    const encodedData = encodeURIComponent(compressed);
    const shareUrl = `${window.location.origin}${window.location.pathname}?data=${encodedData}`;
    
    document.getElementById('share-url').textContent = shareUrl;
    document.getElementById('share-url-container').style.display = 'block';
}

function compressData(jsonString) {
    // Simple compression by removing unnecessary whitespace and shortening keys
    const compressed = jsonString
        .replace(/\s+/g, '')  // Remove all whitespace
        .replace(/"name":/g, '"n":')
        .replace(/"totalTime":/g, '"t":')
        .replace(/"onField":/g, '"o":')
        .replace(/"sessionStart":/g, '"s":')
        .replace(/"lastTimestamp":/g, '"l":')
        .replace(/"rotationLog":/g, '"r":')
        .replace(/"scorer":/g, '"sc":')
        .replace(/"team":/g, '"tm":')
        .replace(/"time":/g, '"ti":')
        .replace(/"quarter":/g, '"q":')
        .replace(/"timestamp":/g, '"ts":')
        .replace(/"teamName":/g, '"tn":')
        .replace(/"quarterClocks":/g, '"qc":');
    
    return btoa(compressed);
}

function decompressData(compressedData) {
    try {
        const compressed = atob(compressedData);
        // Restore the original keys
        const restored = compressed
            .replace(/"n":/g, '"name":')
            .replace(/"t":/g, '"totalTime":')
            .replace(/"o":/g, '"onField":')
            .replace(/"s":/g, '"sessionStart":')
            .replace(/"l":/g, '"lastTimestamp":')
            .replace(/"r":/g, '"rotationLog":')
            .replace(/"sc":/g, '"scorer":')
            .replace(/"tm":/g, '"team":')
            .replace(/"ti":/g, '"time":')
            .replace(/"q":/g, '"quarter":')
            .replace(/"ts":/g, '"timestamp":')
            .replace(/"tn":/g, '"teamName":')
            .replace(/"qc":/g, '"quarterClocks":');
        
        return JSON.parse(restored);
    } catch (e) {
        console.error('Decompression failed:', e);
        return null;
    }
}

function copyShareUrl() {
    const shareUrl = document.getElementById('share-url').textContent;
    navigator.clipboard.writeText(shareUrl).then(() => {
        alert('Link copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Link copied to clipboard!');
    });
}

function closeShareModal() {
    document.getElementById('share-modal').style.display = 'none';
}

function checkForImportData() {
    const urlParams = new URLSearchParams(window.location.search);
    let importData = urlParams.get('data') || urlParams.get('import'); // Support both old and new format
    
    if (importData) {
        try {
            let teamData;
            
            // Try new compressed format first
            if (urlParams.get('data')) {
                teamData = decompressData(decodeURIComponent(importData));
            }
            
            // Fallback to old format
            if (!teamData && urlParams.get('import')) {
                teamData = JSON.parse(atob(importData));
            }
            
            if (teamData) {
                pendingImportData = teamData;
                document.getElementById('import-modal').style.display = 'block';
            } else {
                throw new Error('Invalid data format');
            }
        } catch (e) {
            console.error('Invalid import data:', e);
            alert('Invalid or corrupted share link. Please ask for a new link.');
            // Remove the import parameter
            const url = new URL(window.location);
            url.searchParams.delete('import');
            url.searchParams.delete('data');
            window.history.replaceState({}, '', url);
        }
    }
}

function confirmImport() {
    if (!pendingImportData) return;
    
    const { team, goals: importedGoals, quarterClocks, teamName } = pendingImportData;
    
    // Import team data
    teams[teamName] = team;
    if (importedGoals) {
        goals[teamName] = importedGoals;
    }
    
    // Import quarter clocks if available
    if (quarterClocks) {
        teamQuarterClocks[teamName] = quarterClocks;
    }
    
    // Update UI
    updateTeamOptions();
    
    // Select the imported team
    document.getElementById('team-select').value = teamName;
    loadSelectedTeam();
    
    saveTeams();
    saveGoals();
    saveTeamQuarterClocks();
    
    // Clear import data and URL
    pendingImportData = null;
    const url = new URL(window.location);
    url.searchParams.delete('import');
    url.searchParams.delete('data');
    window.history.replaceState({}, '', url);
    
    document.getElementById('import-modal').style.display = 'none';
    alert(`Team "${teamName}" imported successfully!`);
}

function cancelImport() {
    pendingImportData = null;
    // Remove import parameter from URL
    const url = new URL(window.location);
    url.searchParams.delete('import');
    url.searchParams.delete('data');
    window.history.replaceState({}, '', url);
    
    document.getElementById('import-modal').style.display = 'none';
}

function saveTeams() {
    try {
        localStorage.setItem('soccerTeams', JSON.stringify(teams));
    } catch (e) {
        console.error('Error saving teams:', e);
    }
}

function saveGoals() {
    try {
        localStorage.setItem('soccerGoals', JSON.stringify(goals));
    } catch (e) {
        console.error('Error saving goals:', e);
    }
}

function saveTeamQuarterClocks() {
    try {
        localStorage.setItem('teamQuarterClocks', JSON.stringify(teamQuarterClocks));
    } catch (e) {
        console.error('Error saving quarter clocks:', e);
    }
}

function loadTeams() {
    try {
        const saved = localStorage.getItem('soccerTeams');
        if (saved) {
            teams = JSON.parse(saved);
            updateTeamOptions();
            
            // Load previously selected team
            const savedTeam = localStorage.getItem('selectedTeam');
            if (savedTeam && teams[savedTeam]) {
                document.getElementById('team-select').value = savedTeam;
                loadSelectedTeam();
            }
        }
    } catch (e) {
        console.error('Error loading teams:', e);
        teams = {};
    }
}

function loadGoals() {
    try {
        const saved = localStorage.getItem('soccerGoals');
        if (saved) {
            goals = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Error loading goals:', e);
        goals = {};
    }
}

function loadTeamQuarterClocks() {
    try {
        const saved = localStorage.getItem('teamQuarterClocks');
        if (saved) {
            teamQuarterClocks = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Error loading quarter clocks:', e);
        teamQuarterClocks = {};
    }
}

function loadUserPreferences() {
    // Load sound setting
    const savedSound = localStorage.getItem('soundEnabled');
    if (savedSound !== null) {
        soundEnabled = JSON.parse(savedSound);
        document.getElementById('sound-status').textContent = soundEnabled ? '🔊' : '🔇';
    }
    
    // Load controls collapsed state
    const savedCollapsed = localStorage.getItem('controlsCollapsed');
    if (savedCollapsed !== null) {
        controlsCollapsed = JSON.parse(savedCollapsed);
        const content = document.getElementById('collapsible-content');
        const toggle = document.getElementById('collapse-toggle');
        
        if (controlsCollapsed) {
            content.classList.add('collapsed');
            toggle.textContent = '🔽';
        }
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadTeams();
    loadGoals();
    loadTeamQuarterClocks();
    loadUserPreferences();
    checkForImportData();
    updateQuarterClock();
    initializeQuarterButtons();
    
    // Add event listeners for goal team radio buttons
    const goalTeamRadios = document.querySelectorAll('input[name="goal-team"]');
    goalTeamRadios.forEach(radio => {
        radio.addEventListener('change', updateGoalScorerVisibility);
    });
    
    // For edit goal modal
    const editGoalTeamRadios = document.querySelectorAll('input[name="edit-goal-team"]');
    editGoalTeamRadios.forEach(radio => {
        radio.addEventListener('change', updateEditGoalScorerVisibility);
    });
    
    // Handle new player name input enter key
    document.getElementById('new-player-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addPlayerFromModal();
        }
    });
});

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
});
