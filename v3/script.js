// Global variables
let teams = {};
let currentTeam = '';
let tempPlayers = [];
let teamQuarterClocks = {};
let quarterTimerInterval = null;
let quarterStartTime = null;
let currentQuarter = 'Q1';
let events = [];
let soundEnabled = true;
let updateInterval = null;
let controlsCollapsed = false;
let rotationHistoryCollapsed = true;
let eventModalMode = 'add';
let editingEventIndex = -1;
let pendingImportData = null;

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
    
    oscillator.frequency.value = 880;
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

function toggleRotationHistory() {
    const content = document.getElementById('rotation-log');
    const toggle = document.getElementById('rotation-toggle');
    
    rotationHistoryCollapsed = !rotationHistoryCollapsed;
    
    if (rotationHistoryCollapsed) {
        content.classList.add('collapsed');
        toggle.textContent = '🔽';
    } else {
        content.classList.remove('collapsed');
        toggle.textContent = '🔼';
    }
    
    localStorage.setItem('rotationHistoryCollapsed', rotationHistoryCollapsed);
}

function saveRotationTime() {
    if (!currentTeam) return;
    
    const rotationTime = document.getElementById('rotation').value;
    const teamRotationTimes = JSON.parse(localStorage.getItem('teamRotationTimes')) || {};
    teamRotationTimes[currentTeam] = rotationTime;
    localStorage.setItem('teamRotationTimes', JSON.stringify(teamRotationTimes));
}

function loadRotationTime() {
    if (!currentTeam) return;
    
    const teamRotationTimes = JSON.parse(localStorage.getItem('teamRotationTimes')) || {};
    if (teamRotationTimes[currentTeam]) {
        document.getElementById('rotation').value = teamRotationTimes[currentTeam];
    }
}

function initializeQuarterButtons() {
    document.querySelectorAll('.quarter-button').forEach(button => {
        button.addEventListener('click', () => {
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
    
    quarterClockState.isRunning = true;
    quarterClockState.startTime = quarterStartTime;
    quarterClockState.elapsedTime = currentClocks[currentQuarter];
    saveQuarterClockState();
    
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
    
    quarterClockState.isRunning = false;
    quarterClockState.startTime = null;
    const currentClocks = getCurrentQuarterClocks();
    quarterClockState.elapsedTime = currentClocks[currentQuarter];
    saveQuarterClockState();
    
    const now = Date.now();
    teams[currentTeam]?.forEach(player => {
        if (player.onField && player.sessionStart) {
            const sessionTime = Math.floor((now - player.sessionStart) / 1000);
            player.totalTime += sessionTime;
            
            player.rotationLog.push({
                in: new Date(player.sessionStart).toLocaleTimeString(),
                out: new Date(now).toLocaleTimeString(),
                duration: formatTime(sessionTime),
                quarter: currentQuarter
            });
            
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
                
                const now = Date.now();
                const timeSinceStart = Math.floor((now - state.startTime) / 1000);
                const currentClocks = getCurrentQuarterClocks();
                currentClocks[state.quarter] = timeSinceStart;
                
                quarterStartTime = state.startTime;
                quarterTimerInterval = setInterval(updateQuarterClock, 100);
                
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
    
    if (currentTeam) {
        localStorage.setItem('selectedTeam', currentTeam);
        renderPlayerCards();
        updateCaptainOptions();
        updateGoaltenderOptions();
        renderRotationLog();
        renderEventsLog();
        updateScoreDisplay();
        updateQuarterClock();
        loadQuarterClockState();
        loadRotationTime();
        startUpdateInterval();
    } else {
        localStorage.removeItem('selectedTeam');
        document.getElementById('players').innerHTML = '';
        document.getElementById('quarter-clock').textContent = '0:00';
        stopUpdateInterval();
        
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
    const goaltender = document.getElementById('goaltender-select').value;
    
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
        
        card.className = 'player-card';
        
        const existingAlert = card.querySelector('.alert-icon');
        if (existingAlert) existingAlert.remove();
        
        if (player.onField) {
            card.classList.add('on-field');
            
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
        
        const existingCaptainBadge = card.querySelector('.captain-badge');
        const existingGoaltenderBadge = card.querySelector('.goaltender-badge');
        if (existingCaptainBadge) existingCaptainBadge.remove();
        if (existingGoaltenderBadge) existingGoaltenderBadge.remove();
        
        if (captain === player.name) {
            const badge = document.createElement('div');
            badge.className = 'captain-badge';
            badge.textContent = '👑';
            card.appendChild(badge);
        }
        
        if (goaltender === player.name) {
            const badge = document.createElement('div');
            badge.className = 'goaltender-badge';
            badge.textContent = '🥅';
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
        const card = document.getElementById(`player-${playerIndex}`);
        const alertIcon = card?.querySelector('.alert-icon');
        if (alertIcon) alertIcon.remove();
        
        if (player.sessionStart) {
            const sessionTime = Math.floor((now - player.sessionStart) / 1000);
            player.totalTime += sessionTime;
            
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
        player.onField = true;
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

function updateGoaltenderOptions() {
    if (!currentTeam) return;
    
    const select = document.getElementById('goaltender-select');
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

function showEventModal() {
    if (!currentTeam) {
        alert('Please select a team first');
        return;
    }
    
    eventModalMode = 'log';
    setupEventModal();
    document.getElementById('event-modal').style.display = 'block';
}

function showAddEventModal() {
    eventModalMode = 'add';
    setupEventModal();
    document.getElementById('event-modal').style.display = 'block';
}

function editEvent(index) {
    eventModalMode = 'edit';
    editingEventIndex = index;
    setupEventModal();
    
    const event = events[currentTeam][index];
    document.getElementById('event-type').value = event.type;
    updateEventOptions();
    
    if (event.type === 'goal') {
        if (event.team === 'team') {
            document.querySelector('input[name="event-team"][value="team"]').checked = true;
            document.getElementById('event-player').value = event.player;
        } else {
            document.querySelector('input[name="event-team"][value="other"]').checked = true;
        }
        updateEventPlayerVisibility();
    } else if (event.type === 'penalty') {
        document.querySelector(`input[name="penalty-team"][value="${event.team}"]`).checked = true;
    } else {
        document.getElementById('event-player').value = event.player;
    }
    
    document.getElementById('event-modal').style.display = 'block';
}

function setupEventModal() {
    document.getElementById('event-type').value = '';
    document.getElementById('event-options').innerHTML = '';
    
    const titleMap = {
        'log': 'Log Event',
        'add': 'Add Event',
        'edit': 'Edit Event'
    };
    
    const buttonMap = {
        'log': '✅ Record Event',
        'add': '✅ Add Event',
        'edit': '✅ Save Changes'
    };
    
    document.getElementById('event-modal-title').textContent = titleMap[eventModalMode];
    document.getElementById('event-submit-btn').textContent = buttonMap[eventModalMode];
    
    const quarterRow = document.getElementById('quarter-row');
    if (eventModalMode === 'add') {
        quarterRow.style.display = 'flex';
        document.getElementById('event-quarter').value = currentQuarter;
    } else {
        quarterRow.style.display = 'none';
    }
}

function updateEventOptions() {
    const eventType = document.getElementById('event-type').value;
    const optionsContainer = document.getElementById('event-options');
    optionsContainer.innerHTML = '';
    
    if (eventType === 'goal' || eventType === 'penalty') {
        if (eventType === 'goal') {
            optionsContainer.innerHTML = `
                <div style="margin-top: 20px;">
                    <label>
                        <input type="radio" name="event-team" value="team" checked> Our Team
                    </label>
                    <label style="margin-left: 20px;">
                        <input type="radio" name="event-team" value="other"> Other Team
                    </label>
                </div>
                <div id="event-player-container">
                    <select id="event-player">
                        <option value="">Select Player</option>
                    </select>
                </div>
            `;
            
            const select = document.getElementById('event-player');
            teams[currentTeam].forEach(player => {
                const option = document.createElement('option');
                option.value = player.name;
                option.textContent = player.name;
                select.appendChild(option);
            });
            
            const teamRadios = document.querySelectorAll('input[name="event-team"]');
            teamRadios.forEach(radio => {
                radio.addEventListener('change', updateEventPlayerVisibility);
            });
            
        } else if (eventType === 'penalty') {
            optionsContainer.innerHTML = `
                <div>
                    <label>Award penalty point to the following team:</label>
                    <div style="margin-top: 10px;">
                        <label>
                            <input type="radio" name="penalty-team" value="team" checked> Our Team
                        </label>
                        <label style="margin-left: 20px;">
                            <input type="radio" name="penalty-team" value="other"> Other Team
                        </label>
                    </div>
                </div>
            `;
        }
    } else if (eventType && eventType !== 'penalty') {
        optionsContainer.innerHTML = `
            <select id="event-player">
                <option value="">Select Player</option>
            </select>
        `;
        
        const select = document.getElementById('event-player');
        teams[currentTeam].forEach(player => {
            const option = document.createElement('option');
            option.value = player.name;
            option.textContent = player.name;
            select.appendChild(option);
        });
    }
}

function updateEventPlayerVisibility() {
    const eventTeam = document.querySelector('input[name="event-team"]:checked')?.value;
    const playerContainer = document.getElementById('event-player-container');
    
    if (playerContainer) {
        if (eventTeam === 'other') {
            playerContainer.style.display = 'none';
            const playerSelect = document.getElementById('event-player');
            if (playerSelect) playerSelect.value = '';
        } else {
            playerContainer.style.display = 'block';
        }
    }
}

function handleEventSubmit() {
    const eventType = document.getElementById('event-type').value;
    if (!eventType) {
        alert('Please select an event type');
        return;
    }
    
    let eventData = {
        type: eventType,
        time: new Date().toLocaleTimeString(),
        quarter: eventModalMode === 'add' ? document.getElementById('event-quarter').value : currentQuarter,
        timestamp: eventModalMode === 'edit' ? events[currentTeam][editingEventIndex].timestamp : Date.now()
    };
    
    if (eventType === 'goal') {
        const eventTeam = document.querySelector('input[name="event-team"]:checked').value;
        let player = document.getElementById('event-player').value;
        
        if (eventTeam === 'team' && !player) {
            alert('Please select a player');
            return;
        }
        
        if (eventTeam === 'other') {
            player = 'Other Team Player';
        }
        
        eventData.player = player;
        eventData.team = eventTeam;
        
    } else if (eventType === 'penalty') {
        const penaltyTeam = document.querySelector('input[name="penalty-team"]:checked').value;
        eventData.team = penaltyTeam;
        eventData.player = penaltyTeam === 'team' ? currentTeam + ' Player' : 'Other Team Player';
        
    } else {
        const player = document.getElementById('event-player').value;
        if (!player) {
            alert('Please select a player');
            return;
        }
        eventData.player = player;
        eventData.team = 'team';
    }
    
    if (!events[currentTeam]) {
        events[currentTeam] = [];
    }
    
    if (eventModalMode === 'edit') {
        events[currentTeam][editingEventIndex] = eventData;
    } else {
        events[currentTeam].push(eventData);
    }
    
    saveEvents();
    updateScoreDisplay();
    renderEventsLog();
    if (eventModalMode === 'edit') {
        renderManageEventsList();
    }
    closeEventModal();
}

function closeEventModal() {
    document.getElementById('event-modal').style.display = 'none';
    editingEventIndex = -1;
}

function showManageEventsModal() {
    if (!currentTeam) {
        alert('Please select a team first');
        return;
    }
    
    renderManageEventsList();
    document.getElementById('manage-events-modal').style.display = 'block';
}

function renderManageEventsList() {
    const container = document.getElementById('events-list');
    container.innerHTML = '';
    
    const teamEvents = events[currentTeam] || [];
    
    if (teamEvents.length === 0) {
        container.innerHTML = '<p>No events recorded yet.</p>';
        return;
    }
    
    teamEvents.forEach((event, index) => {
        const item = document.createElement('div');
        item.className = 'event-item';
        
        const info = document.createElement('div');
        info.className = 'event-info';
        const teamName = event.team === 'team' ? currentTeam : 'Other Team';
        const eventTypeMap = {
            goal: '⚽ Goal',
            penalty: '🚨 Penalty Point',
            save: '🛡️ Goal Prevented',
            injury: '🤕 Player Injury',
            cleat: '👟 Lost Cleat',
            laces: '👟 Untied Laces',
            headbutt: '🤕 Ball Head-butt'
        };
        
        info.innerHTML = `
            <strong>${eventTypeMap[event.type]}</strong><br>
            <small>${event.player} (${teamName})<br>
            ${event.quarter} - ${event.time}</small>
        `;
        
        const actions = document.createElement('div');
        actions.className = 'event-actions';
        
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️ Edit';
        editBtn.className = 'edit-button';
        editBtn.onclick = () => {
            closeManageEventsModal();
            editEvent(index);
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑 Delete';
        deleteBtn.className = 'delete-button';
        deleteBtn.onclick = () => deleteEvent(index);
        
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        
        item.appendChild(info);
        item.appendChild(actions);
        container.appendChild(item);
    });
}

function deleteEvent(index) {
    if (confirm('Are you sure you want to delete this event?')) {
        events[currentTeam].splice(index, 1);
        saveEvents();
        updateScoreDisplay();
        renderEventsLog();
        renderManageEventsList();
    }
}

function closeManageEventsModal() {
    document.getElementById('manage-events-modal').style.display = 'none';
}

function updateScoreDisplay() {
    if (!currentTeam) return;
    
    const teamEvents = events[currentTeam] || [];
    const teamScore = teamEvents.filter(event => 
        (event.type === 'goal' || event.type === 'penalty') && event.team === 'team'
    ).length;
    const otherScore = teamEvents.filter(event => 
        (event.type === 'goal' || event.type === 'penalty') && event.team === 'other'
    ).length;
    
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

function renderEventsLog() {
    if (!currentTeam) return;
    
    const container = document.getElementById('events-log');
    container.innerHTML = '';
    
    const teamEvents = events[currentTeam] || [];
    
    if (teamEvents.length === 0) {
        container.innerHTML = '<p>No events recorded yet.</p>';
        return;
    }
    
    const table = document.createElement('table');
    table.innerHTML = `
        <tr>
            <th>Event</th>
            <th>Player</th>
            <th>Team</th>
            <th>Quarter</th>
            <th>Time</th>
        </tr>
    `;
    
    const eventTypeMap = {
        goal: '⚽ Goal',
        penalty: '🚨 Penalty Point',
        save: '🛡️ Goal Prevented',
        injury: '🤕 Player Injury',
        cleat: '👟 Lost Cleat',
        laces: '👟 Untied Laces',
        headbutt: '🤕 Ball Head-butt'
    };
    
    teamEvents.forEach(event => {
        const row = table.insertRow();
        const teamName = event.team === 'team' ? currentTeam : 'Other Team';
        row.innerHTML = `
            <td>${eventTypeMap[event.type]}</td>
            <td>${event.player}</td>
            <td>${teamName}</td>
            <td>${event.quarter}</td>
            <td>${event.time}</td>
        `;
    });
    
    container.appendChild(table);
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
    tempPlayers = tempPlayers.filter(player => player.name.trim() !== '');
    teams[currentTeam] = tempPlayers;
    
    saveTeams();
    renderPlayerCards();
    updateCaptainOptions();
    updateGoaltenderOptions();
    closeManageModal();
}

function closeManageModal() {
    document.getElementById('manage-modal').style.display = 'none';
}

function showShareModal() {
    if (!currentTeam) {
        alert('Please select a team first');
        return;
    }
    
    document.getElementById('share-times').checked = false;
    document.getElementById('share-rotation').checked = false;
    document.getElementById('share-events').checked = true;
    document.getElementById('share-quarters').checked = false;
    
    document.getElementById('share-modal').style.display = 'block';
}

function selectAllShareOptions() {
    document.getElementById('share-times').checked = true;
    document.getElementById('share-rotation').checked = true;
    document.getElementById('share-events').checked = true;
    document.getElementById('share-quarters').checked = true;
}

function deselectAllShareOptions() {
    document.getElementById('share-times').checked = false;
    document.getElementById('share-rotation').checked = false;
    document.getElementById('share-events').checked = false;
    document.getElementById('share-quarters').checked = false;
}

function generateAndCopyShareUrl() {
    if (!currentTeam) return;
    
    const shareData = {
        teamName: currentTeam,
        team: teams[currentTeam]
    };
    
    if (document.getElementById('share-times').checked) {
        shareData.team = shareData.team.map(player => ({
            ...player,
            sessionStart: null,
            lastTimestamp: null
        }));
    } else {
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
        shareData.team = shareData.team.map(player => ({
            ...player,
            rotationLog: []
        }));
    }
    
    if (document.getElementById('share-events').checked) {
        shareData.events = events[currentTeam] || [];
    }
    
    if (document.getElementById('share-quarters').checked) {
        shareData.quarterClocks = teamQuarterClocks[currentTeam] || { Q1: 0, Q2: 0, Q3: 0, Q4: 0, OT: 0 };
    }
    
    const compressed = compressData(JSON.stringify(shareData));
    const encodedData = encodeURIComponent(compressed);
    const shareUrl = `${window.location.origin}${window.location.pathname}?data=${encodedData}`;
    
    navigator.clipboard.writeText(shareUrl).then(() => {
        alert("Share link copied to clipboard!\n\nNow redirecting you to tinyurl.com - post your link there for a more shareable URL");
        closeShareModal();
        window.open('https://tinyurl.com', '_blank');
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Share link copied to clipboard!');
        closeShareModal();
        window.open('https://tinyurl.com', '_blank');
    });
}

function closeShareModal() {
    document.getElementById('share-modal').style.display = 'none';
}

function compressData(jsonString) {
    const compressed = jsonString
        .replace(/\s+/g, '')
        .replace(/"name":/g, '"n":')
        .replace(/"totalTime":/g, '"t":')
        .replace(/"onField":/g, '"o":')
        .replace(/"sessionStart":/g, '"s":')
        .replace(/"lastTimestamp":/g, '"l":')
        .replace(/"rotationLog":/g, '"r":')
        .replace(/"player":/g, '"p":')
        .replace(/"team":/g, '"tm":')
        .replace(/"time":/g, '"ti":')
        .replace(/"quarter":/g, '"q":')
        .replace(/"timestamp":/g, '"ts":')
        .replace(/"type":/g, '"tp":')
        .replace(/"teamName":/g, '"tn":')
        .replace(/"events":/g, '"ev":')
        .replace(/"quarterClocks":/g, '"qc":');
    
    return btoa(compressed);
}

function decompressData(compressedData) {
    try {
        const compressed = atob(compressedData);
        const restored = compressed
            .replace(/"n":/g, '"name":')
            .replace(/"t":/g, '"totalTime":')
            .replace(/"o":/g, '"onField":')
            .replace(/"s":/g, '"sessionStart":')
            .replace(/"l":/g, '"lastTimestamp":')
            .replace(/"r":/g, '"rotationLog":')
            .replace(/"p":/g, '"player":')
            .replace(/"tm":/g, '"team":')
            .replace(/"ti":/g, '"time":')
            .replace(/"q":/g, '"quarter":')
            .replace(/"ts":/g, '"timestamp":')
            .replace(/"tp":/g, '"type":')
            .replace(/"tn":/g, '"teamName":')
            .replace(/"ev":/g, '"events":')
            .replace(/"qc":/g, '"quarterClocks":');
        
        return JSON.parse(restored);
    } catch (e) {
        console.error('Decompression failed:', e);
        return null;
    }
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
    
    teams[currentTeam].forEach(player => {
        player.totalTime = 0;
        player.onField = false;
        player.sessionStart = null;
        player.lastTimestamp = null;
        player.rotationLog = [];
    });
    
    if (events[currentTeam]) {
        events[currentTeam] = [];
    }
    
    if (teamQuarterClocks[currentTeam]) {
        teamQuarterClocks[currentTeam] = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, OT: 0 };
    }
    
    if (quarterTimerInterval) {
        clearInterval(quarterTimerInterval);
        quarterTimerInterval = null;
    }
    
    quarterClockState = { isRunning: false, startTime: null, elapsedTime: 0 };
    localStorage.removeItem('quarterClockState');
    
    saveTeams();
    saveEvents();
    saveTeamQuarterClocks();
    updatePlayerDisplay();
    renderRotationLog();
    renderEventsLog();
    updateScoreDisplay();
    updateQuarterClock();
    closeResetWarning();
}

function checkForImportData() {
    const urlParams = new URLSearchParams(window.location.search);
    let importData = urlParams.get('data') || urlParams.get('import');
    
    if (importData) {
        try {
            let teamData;
            
            if (urlParams.get('data')) {
                teamData = decompressData(decodeURIComponent(importData));
            }
            
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
            const url = new URL(window.location);
            url.searchParams.delete('import');
            url.searchParams.delete('data');
            window.history.replaceState({}, '', url);
        }
    }
}

function confirmImport() {
    if (!pendingImportData) return;
    
    const { team, events: importedEvents, quarterClocks, teamName } = pendingImportData;
    
    teams[teamName] = team;
    if (importedEvents) {
        events[teamName] = importedEvents;
    }
    
    if (quarterClocks) {
        teamQuarterClocks[teamName] = quarterClocks;
    }
    
    updateTeamOptions();
    
    document.getElementById('team-select').value = teamName;
    loadSelectedTeam();
    
    saveTeams();
    saveEvents();
    saveTeamQuarterClocks();
    
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

function saveEvents() {
    try {
        localStorage.setItem('soccerEvents', JSON.stringify(events));
    } catch (e) {
        console.error('Error saving events:', e);
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

function loadEvents() {
    try {
        const saved = localStorage.getItem('soccerEvents');
        if (saved) {
            events = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Error loading events:', e);
        events = {};
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
    const savedSound = localStorage.getItem('soundEnabled');
    if (savedSound !== null) {
        soundEnabled = JSON.parse(savedSound);
        document.getElementById('sound-status').textContent = soundEnabled ? '🔊' : '🔇';
    }
    
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
    
    const savedRotationCollapsed = localStorage.getItem('rotationHistoryCollapsed');
    if (savedRotationCollapsed !== null) {
        rotationHistoryCollapsed = JSON.parse(savedRotationCollapsed);
    }
    
    const rotationContent = document.getElementById('rotation-log');
    const rotationToggle = document.getElementById('rotation-toggle');
    
    if (rotationHistoryCollapsed) {
        rotationContent.classList.add('collapsed');
        rotationToggle.textContent = '🔽';
    } else {
        rotationContent.classList.remove('collapsed');
        rotationToggle.textContent = '🔼';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadTeams();
    loadEvents();
    loadTeamQuarterClocks();
    loadUserPreferences();
    checkForImportData();
    updateQuarterClock();
    initializeQuarterButtons();
    
    document.getElementById('new-player-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addPlayerFromModal();
        }
    });
});

window.addEventListener('click', (e) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
});
