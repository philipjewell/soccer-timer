// ===== Storage Keys =====
const DATA_KEY = 'soccerTimerV4';
const PREFS_KEY = 'soccerTimerV4_prefs';

// ===== Runtime State (transient, not persisted) =====
let quarterInterval = null;
let updateInterval = null;
let audioContext = null;
let tempPlayers = [];
let pendingImportData = null;
let eventModalMode = 'add';
let editingEventIndex = -1;
let notifiedPlayers = new Set();

const AudioCtx = window.AudioContext || window.webkitAudioContext;

// ===== Data Access Layer =====

function getAllTeams() {
    try {
        return JSON.parse(localStorage.getItem(DATA_KEY) || '{}');
    } catch (e) {
        console.error('Error reading team data:', e);
        return {};
    }
}

function saveAllTeams(data) {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
}

function getTeam(name) {
    if (!name) return null;
    return getAllTeams()[name] || null;
}

function saveTeam(name, teamData) {
    const all = getAllTeams();
    all[name] = teamData;
    saveAllTeams(all);
}

function removeTeam(name) {
    const all = getAllTeams();
    delete all[name];
    saveAllTeams(all);
}

function getPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function savePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function getPref(key, defaultVal) {
    const val = getPrefs()[key];
    return val !== undefined ? val : defaultVal;
}

function setPref(key, value) {
    const prefs = getPrefs();
    prefs[key] = value;
    savePrefs(prefs);
}

// ===== Data Constructors =====

function createTeamData(rotationTime) {
    return {
        controls: {
            rotation_time: rotationTime || 5,
            notifications: true
        },
        gameclock: {
            current_quarter: 'Q1',
            running: false,
            run_start: null,
            elapsed: { Q1: 0, Q2: 0, Q3: 0, Q4: 0, OT: 0 }
        },
        roster: [],
        rotation_history: [],
        event_history: []
    };
}

function createPlayer(name) {
    return {
        id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: name,
        is_captain: false,
        is_goalkeeper: false,
        active: false,
        field_time: 0,
        session_start: null
    };
}

// ===== Selected Team =====

function getSelectedTeam() {
    return getPref('selectedTeam', '');
}

function setSelectedTeam(name) {
    setPref('selectedTeam', name);
}

// ===== Computed Values =====

function getPlayerDisplayTime(player) {
    let total = player.field_time || 0;
    if (player.active && player.session_start) {
        total += Math.floor((Date.now() - player.session_start) / 1000);
    }
    return total;
}

function getPlayerSessionTime(player) {
    if (player.active && player.session_start) {
        return Math.floor((Date.now() - player.session_start) / 1000);
    }
    return 0;
}

function getQuarterElapsed(team) {
    const gc = team.gameclock;
    const q = gc.current_quarter;
    let elapsed = gc.elapsed[q] || 0;
    if (gc.running && gc.run_start) {
        elapsed += Math.floor((Date.now() - gc.run_start) / 1000);
    }
    return elapsed;
}

function getScores(team) {
    const events = team.event_history || [];
    const teamScore = events.filter(e =>
        (e.event_type === 'goal' || e.event_type === 'penalty') && e.team === 'team'
    ).length;
    const otherScore = events.filter(e =>
        (e.event_type === 'goal' || e.event_type === 'penalty') && e.team === 'other'
    ).length;
    return { team: teamScore, other: otherScore };
}

// ===== Formatting =====

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===== Audio =====

function playDing() {
    if (getPref('soundEnabled', true) === false) return;

    if (!audioContext) {
        audioContext = new AudioCtx();
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

// ===== Clock Operations =====

function onStartClock() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team || team.gameclock.running) return;

    const now = Date.now();
    team.gameclock.running = true;
    team.gameclock.run_start = now;

    // Start sessions for active players who don't have one yet
    team.roster.forEach(player => {
        if (player.active && !player.session_start) {
            player.session_start = now;
        }
    });

    saveTeam(teamName, team);
    startQuarterInterval();
}

function onStopClock() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team || !team.gameclock.running) return;

    const now = Date.now();
    const gc = team.gameclock;
    const q = gc.current_quarter;

    // Accumulate quarter time
    if (gc.run_start) {
        gc.elapsed[q] = (gc.elapsed[q] || 0) + Math.floor((now - gc.run_start) / 1000);
    }
    gc.running = false;
    gc.run_start = null;

    // End all active player sessions and log rotations
    team.roster.forEach(player => {
        if (player.active && player.session_start) {
            const sessionTime = Math.floor((now - player.session_start) / 1000);
            player.field_time += sessionTime;

            team.rotation_history.push({
                player: player.name,
                quarter: q,
                time_in: new Date(player.session_start).toLocaleTimeString(),
                time_out: new Date(now).toLocaleTimeString(),
                duration: formatTime(sessionTime)
            });

            player.session_start = null;
        }
    });

    saveTeam(teamName, team);
    stopQuarterInterval();
    renderAll();
}

function togglePlayerActive(playerId) {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const player = team.roster.find(p => p.id === playerId);
    if (!player) return;

    const now = Date.now();
    const gc = team.gameclock;

    if (player.active) {
        // Sub out
        if (player.session_start) {
            const sessionTime = Math.floor((now - player.session_start) / 1000);
            player.field_time += sessionTime;

            team.rotation_history.push({
                player: player.name,
                quarter: gc.current_quarter,
                time_in: new Date(player.session_start).toLocaleTimeString(),
                time_out: new Date(now).toLocaleTimeString(),
                duration: formatTime(sessionTime)
            });

            player.session_start = null;
        }
        player.active = false;
        notifiedPlayers.delete(playerId);
    } else {
        // Sub in
        player.active = true;
        if (gc.running) {
            player.session_start = now;
        }
    }

    saveTeam(teamName, team);
    updatePlayerDisplay();
    renderRotationLog();
}

// ===== Timer Intervals =====

function startQuarterInterval() {
    if (quarterInterval) return;
    quarterInterval = setInterval(() => {
        updateQuarterClockDisplay();
        updatePlayerDisplay();
    }, 100);
}

function stopQuarterInterval() {
    if (quarterInterval) {
        clearInterval(quarterInterval);
        quarterInterval = null;
    }
}

function startUpdateInterval() {
    if (updateInterval) return;
    updateInterval = setInterval(() => {
        updatePlayerDisplay();
        updateQuarterClockDisplay();
        updatePageTitle();
    }, 1000);
}

function stopUpdateInterval() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

// ===== UI: Team Management =====

function onCreateTeam() {
    const teamName = prompt('Enter team name:');
    if (!teamName || teamName.trim() === '') return;

    const trimmed = teamName.trim();
    if (getTeam(trimmed)) {
        alert('A team with that name already exists.');
        return;
    }

    saveTeam(trimmed, createTeamData());
    setSelectedTeam(trimmed);
    renderAll();
}

function onDeleteTeam() {
    const teamName = getSelectedTeam();
    if (!teamName) {
        alert('Please select a team first.');
        return;
    }

    document.getElementById('delete-team-message').textContent =
        `Are you sure you want to delete "${teamName}"?`;
    document.getElementById('delete-team-modal').style.display = 'block';
}

function confirmDeleteTeam() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    // Stop any running intervals
    stopQuarterInterval();

    removeTeam(teamName);
    setSelectedTeam('');
    closeDeleteTeamModal();
    renderAll();
}

function closeDeleteTeamModal() {
    document.getElementById('delete-team-modal').style.display = 'none';
}

function onTeamSelect() {
    const teamName = document.getElementById('team-select').value;
    setSelectedTeam(teamName);

    // Stop old intervals
    stopQuarterInterval();
    notifiedPlayers.clear();

    renderAll();
}

// ===== UI: Controls =====

function toggleSound() {
    const current = getPref('soundEnabled', true);
    setPref('soundEnabled', !current);
    document.getElementById('sound-status').textContent = !current ? '🔊' : '🔇';
}

function toggleControls() {
    const content = document.getElementById('collapsible-content');
    const toggle = document.getElementById('collapse-toggle');
    const collapsed = content.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '🔽' : '🔼';
    setPref('controlsCollapsed', collapsed);
}

function toggleRotationHistory() {
    const content = document.getElementById('rotation-log');
    const toggle = document.getElementById('rotation-toggle');
    const collapsed = content.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '🔽' : '🔼';
    setPref('rotationHistoryCollapsed', collapsed);
}

function onRotationTimeChange() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    team.controls.rotation_time = parseInt(document.getElementById('rotation').value) || 5;
    saveTeam(teamName, team);
}

function onCaptainChange() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const selectedName = document.getElementById('captain-select').value;
    team.roster.forEach(p => {
        p.is_captain = (p.name === selectedName);
    });
    saveTeam(teamName, team);
    updatePlayerDisplay();
}

function onGoaltenderChange() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const selectedName = document.getElementById('goaltender-select').value;
    team.roster.forEach(p => {
        p.is_goalkeeper = (p.name === selectedName);
    });
    saveTeam(teamName, team);
    updatePlayerDisplay();
}

function onQuarterChange(quarter) {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    // If clock is running, stop it first
    if (team.gameclock.running) {
        onStopClock();
        // Re-read team after stop
        const updatedTeam = getTeam(teamName);
        updatedTeam.gameclock.current_quarter = quarter;
        saveTeam(teamName, updatedTeam);
    } else {
        team.gameclock.current_quarter = quarter;
        saveTeam(teamName, team);
    }

    updateQuarterButtons();
    updateQuarterClockDisplay();
}

// ===== UI: Rendering =====

function renderAll() {
    const teamName = getSelectedTeam();

    updateTeamSelector();
    updateQuarterButtons();

    if (teamName) {
        const team = getTeam(teamName);
        if (!team) {
            setSelectedTeam('');
            renderAll();
            return;
        }

        document.getElementById('team-title').textContent = `${teamName} Time Tracker`;
        document.getElementById('rotation').value = team.controls.rotation_time;

        renderPlayerCards();
        updatePlayerDisplay();
        updateCaptainSelector(team);
        updateGoaltenderSelector(team);
        renderRotationLog();
        renderEventsLog();
        updateScoreDisplay();
        updateQuarterClockDisplay();
        updatePageTitle();

        // Resume clock interval if running
        if (team.gameclock.running) {
            startQuarterInterval();
        }

        startUpdateInterval();
    } else {
        document.getElementById('players').innerHTML = '';
        document.getElementById('rotation-log').innerHTML = '';
        document.getElementById('events-log').innerHTML = '';
        document.getElementById('quarter-clock').textContent = '0:00';
        document.getElementById('team-title').textContent = 'Soccer Time Tracker';
        document.title = 'Soccer Time Tracker';
        document.getElementById('team-score').textContent = 'Team: 0';
        document.getElementById('other-score').textContent = 'Other: 0';
        document.getElementById('captain-select').innerHTML = '<option value="">None</option>';
        document.getElementById('goaltender-select').innerHTML = '<option value="">None</option>';
        stopUpdateInterval();
        stopQuarterInterval();
    }
}

function updateTeamSelector() {
    const select = document.getElementById('team-select');
    const selectedTeam = getSelectedTeam();
    const allTeams = getAllTeams();

    select.innerHTML = '<option value="">Select Team</option>';
    Object.keys(allTeams).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        if (name === selectedTeam) option.selected = true;
        select.appendChild(option);
    });
}

function updateQuarterButtons() {
    const teamName = getSelectedTeam();
    const team = teamName ? getTeam(teamName) : null;
    const currentQuarter = team ? team.gameclock.current_quarter : 'Q1';

    document.querySelectorAll('.quarter-button').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-quarter') === currentQuarter);
    });
}

function updateQuarterClockDisplay() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const elapsed = getQuarterElapsed(team);
    document.getElementById('quarter-clock').textContent = formatTime(elapsed);
}

function renderPlayerCards() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const container = document.getElementById('players');
    container.innerHTML = '';

    team.roster.forEach((player) => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.id = `player-${player.id}`;
        card.onclick = () => togglePlayerActive(player.id);

        const nameDiv = document.createElement('div');
        nameDiv.className = 'player-name';
        nameDiv.textContent = player.name;

        const timeDiv = document.createElement('div');
        timeDiv.className = 'player-time';
        timeDiv.id = `time-${player.id}`;

        card.appendChild(nameDiv);
        card.appendChild(timeDiv);
        container.appendChild(card);
    });
}

function updatePlayerDisplay() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const rotationSeconds = (team.controls.rotation_time || 5) * 60;

    team.roster.forEach(player => {
        const card = document.getElementById(`player-${player.id}`);
        const timeDiv = document.getElementById(`time-${player.id}`);

        if (!card || !timeDiv) return;

        const displayTime = getPlayerDisplayTime(player);
        const sessionTime = getPlayerSessionTime(player);

        timeDiv.textContent = formatTime(displayTime);

        // Reset classes
        card.className = 'player-card';

        // Remove existing badges and alerts
        const existingAlert = card.querySelector('.alert-icon');
        const existingCaptain = card.querySelector('.captain-badge');
        const existingGoaltender = card.querySelector('.goaltender-badge');
        if (existingAlert) existingAlert.remove();
        if (existingCaptain) existingCaptain.remove();
        if (existingGoaltender) existingGoaltender.remove();

        if (player.active) {
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

                if (!notifiedPlayers.has(player.id)) {
                    notifiedPlayers.add(player.id);
                    playDing();
                    if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification(`${player.name} has exceeded the rotation time!`);
                    }
                }
            }
        } else if (displayTime === 0) {
            card.classList.add('not-played');
        }

        // Captain badge
        if (player.is_captain) {
            const badge = document.createElement('div');
            badge.className = 'captain-badge';
            badge.textContent = '👑';
            card.appendChild(badge);
        }

        // Goaltender badge
        if (player.is_goalkeeper) {
            const badge = document.createElement('div');
            badge.className = 'goaltender-badge';
            badge.textContent = '🥅';
            card.appendChild(badge);
        }
    });
}

function updateCaptainSelector(team) {
    const select = document.getElementById('captain-select');
    const captain = team.roster.find(p => p.is_captain);
    select.innerHTML = '<option value="">None</option>';

    team.roster.forEach(player => {
        const option = document.createElement('option');
        option.value = player.name;
        option.textContent = player.name;
        if (captain && captain.name === player.name) option.selected = true;
        select.appendChild(option);
    });
}

function updateGoaltenderSelector(team) {
    const select = document.getElementById('goaltender-select');
    const goaltender = team.roster.find(p => p.is_goalkeeper);
    select.innerHTML = '<option value="">None</option>';

    team.roster.forEach(player => {
        const option = document.createElement('option');
        option.value = player.name;
        option.textContent = player.name;
        if (goaltender && goaltender.name === player.name) option.selected = true;
        select.appendChild(option);
    });
}

function updateScoreDisplay() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const scores = getScores(team);
    document.getElementById('team-score').textContent = `${teamName}: ${scores.team}`;
    document.getElementById('other-score').textContent = `Other: ${scores.other}`;
}

function updatePageTitle() {
    const teamName = getSelectedTeam();
    if (!teamName) {
        document.title = 'Soccer Time Tracker';
        return;
    }

    const team = getTeam(teamName);
    if (!team) return;

    const scores = getScores(team);
    document.title = `${scores.team}:${scores.other} ${teamName} | Soccer Timer`;
}

function renderRotationLog() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const container = document.getElementById('rotation-log');
    const rotations = team.rotation_history || [];

    if (rotations.length === 0) {
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

    // Show most recent first
    [...rotations].reverse().forEach(rotation => {
        const row = table.insertRow();
        row.innerHTML = `
            <td>${rotation.player}</td>
            <td>${rotation.quarter}</td>
            <td>${rotation.time_in}</td>
            <td>${rotation.time_out}</td>
            <td>${rotation.duration}</td>
        `;
    });

    container.innerHTML = '';
    container.appendChild(table);
}

function renderEventsLog() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const container = document.getElementById('events-log');
    const teamEvents = team.event_history || [];

    if (teamEvents.length === 0) {
        container.innerHTML = '<p>No events recorded yet.</p>';
        return;
    }

    const eventTypeMap = {
        goal: '⚽ Goal',
        penalty: '🚨 Penalty Point',
        save: '🛡️ Goal Prevented',
        injury: '🤕 Player Injury',
        cleat: '👟 Lost Cleat',
        laces: '👟 Untied Laces',
        headbutt: '🤕 Ball Head-butt'
    };

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

    teamEvents.forEach(event => {
        const row = table.insertRow();
        const teamLabel = event.team === 'team' ? teamName : 'Other Team';
        row.innerHTML = `
            <td>${eventTypeMap[event.event_type] || event.event_type}</td>
            <td>${event.player}</td>
            <td>${teamLabel}</td>
            <td>${event.quarter}</td>
            <td>${event.time}</td>
        `;
    });

    container.innerHTML = '';
    container.appendChild(table);
}

// ===== Event Modal =====

function showEventModal() {
    const teamName = getSelectedTeam();
    if (!teamName) {
        alert('Please select a team first');
        return;
    }

    eventModalMode = 'log';
    setupEventModal();
    document.getElementById('event-modal').style.display = 'block';
}

function showAddEventModal() {
    closeManageEventsModal();
    eventModalMode = 'add';
    setupEventModal();
    document.getElementById('event-modal').style.display = 'block';
}

function editEvent(index) {
    const teamName = getSelectedTeam();
    const team = getTeam(teamName);
    if (!team) return;

    eventModalMode = 'edit';
    editingEventIndex = index;
    setupEventModal();

    const event = team.event_history[index];
    document.getElementById('event-type').value = event.event_type;
    updateEventOptions();

    if (event.event_type === 'goal') {
        if (event.team === 'team') {
            document.querySelector('input[name="event-team"][value="team"]').checked = true;
            document.getElementById('event-player').value = event.player;
        } else {
            document.querySelector('input[name="event-team"][value="other"]').checked = true;
        }
        updateEventPlayerVisibility();
    } else if (event.event_type === 'penalty') {
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

    const teamName = getSelectedTeam();
    const team = teamName ? getTeam(teamName) : null;
    const currentQuarter = team ? team.gameclock.current_quarter : 'Q1';

    const quarterRow = document.getElementById('quarter-row');
    if (eventModalMode === 'add') {
        quarterRow.style.display = 'flex';
        document.getElementById('event-quarter').value = currentQuarter;
    } else {
        quarterRow.style.display = 'none';
    }
}

function updateEventOptions() {
    const teamName = getSelectedTeam();
    const team = teamName ? getTeam(teamName) : null;
    if (!team) return;

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
            team.roster.forEach(player => {
                const option = document.createElement('option');
                option.value = player.name;
                option.textContent = player.name;
                select.appendChild(option);
            });

            document.querySelectorAll('input[name="event-team"]').forEach(radio => {
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
    } else if (eventType) {
        optionsContainer.innerHTML = `
            <select id="event-player">
                <option value="">Select Player</option>
            </select>
        `;

        const select = document.getElementById('event-player');
        team.roster.forEach(player => {
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
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const eventType = document.getElementById('event-type').value;
    if (!eventType) {
        alert('Please select an event type');
        return;
    }

    const currentQuarter = team.gameclock.current_quarter;

    let eventData = {
        event_type: eventType,
        time: new Date().toLocaleTimeString(),
        quarter: eventModalMode === 'add' ? document.getElementById('event-quarter').value : currentQuarter,
        timestamp: eventModalMode === 'edit' ? team.event_history[editingEventIndex].timestamp : Date.now()
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
        eventData.player = penaltyTeam === 'team' ? teamName + ' Player' : 'Other Team Player';

    } else {
        const player = document.getElementById('event-player').value;
        if (!player) {
            alert('Please select a player');
            return;
        }
        eventData.player = player;
        eventData.team = 'team';
    }

    if (eventModalMode === 'edit') {
        team.event_history[editingEventIndex] = eventData;
    } else {
        team.event_history.push(eventData);
    }

    saveTeam(teamName, team);
    updateScoreDisplay();
    updatePageTitle();
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

// ===== Manage Events Modal =====

function showManageEventsModal() {
    const teamName = getSelectedTeam();
    if (!teamName) {
        alert('Please select a team first');
        return;
    }

    renderManageEventsList();
    document.getElementById('manage-events-modal').style.display = 'block';
}

function renderManageEventsList() {
    const teamName = getSelectedTeam();
    const team = teamName ? getTeam(teamName) : null;

    const container = document.getElementById('events-list');
    container.innerHTML = '';

    const teamEvents = team ? team.event_history || [] : [];

    if (teamEvents.length === 0) {
        container.innerHTML = '<p>No events recorded yet.</p>';
        return;
    }

    const eventTypeMap = {
        goal: '⚽ Goal',
        penalty: '🚨 Penalty Point',
        save: '🛡️ Goal Prevented',
        injury: '🤕 Player Injury',
        cleat: '👟 Lost Cleat',
        laces: '👟 Untied Laces',
        headbutt: '🤕 Ball Head-butt'
    };

    teamEvents.forEach((event, index) => {
        const item = document.createElement('div');
        item.className = 'event-item';

        const info = document.createElement('div');
        info.className = 'event-info';
        const teamLabel = event.team === 'team' ? teamName : 'Other Team';

        info.innerHTML = `
            <strong>${eventTypeMap[event.event_type] || event.event_type}</strong><br>
            <small>${event.player} (${teamLabel})<br>
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
    if (!confirm('Are you sure you want to delete this event?')) return;

    const teamName = getSelectedTeam();
    const team = getTeam(teamName);
    if (!team) return;

    team.event_history.splice(index, 1);
    saveTeam(teamName, team);
    updateScoreDisplay();
    updatePageTitle();
    renderEventsLog();
    renderManageEventsList();
}

function closeManageEventsModal() {
    document.getElementById('manage-events-modal').style.display = 'none';
}

// ===== Manage Players Modal =====

function showManagePlayersModal() {
    const teamName = getSelectedTeam();
    if (!teamName) {
        alert('Please select a team first');
        return;
    }

    const team = getTeam(teamName);
    if (!team) return;

    tempPlayers = JSON.parse(JSON.stringify(team.roster));
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
    const input = document.getElementById('new-player-name');
    const name = input.value.trim();
    if (!name) return;

    tempPlayers.push(createPlayer(name));
    input.value = '';
    renderTempPlayers();
}

function savePlayersFromModal() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    // Filter out empty names
    tempPlayers = tempPlayers.filter(p => p.name.trim() !== '');
    team.roster = tempPlayers;

    saveTeam(teamName, team);
    renderAll();
    closeManageModal();
}

function closeManageModal() {
    document.getElementById('manage-modal').style.display = 'none';
}

// ===== Reset =====

function showResetWarning() {
    const teamName = getSelectedTeam();
    if (!teamName) {
        alert('Please select a team first');
        return;
    }
    document.getElementById('reset-warning-modal').style.display = 'block';
}

function closeResetWarning() {
    document.getElementById('reset-warning-modal').style.display = 'none';
}

function confirmReset() {
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    // Reset player times
    team.roster.forEach(player => {
        player.field_time = 0;
        player.active = false;
        player.session_start = null;
    });

    // Clear histories
    team.rotation_history = [];
    team.event_history = [];

    // Reset game clock
    team.gameclock = {
        current_quarter: 'Q1',
        running: false,
        run_start: null,
        elapsed: { Q1: 0, Q2: 0, Q3: 0, Q4: 0, OT: 0 }
    };

    stopQuarterInterval();
    notifiedPlayers.clear();

    saveTeam(teamName, team);
    closeResetWarning();
    renderAll();
}

// ===== Share =====

function showShareModal() {
    const teamName = getSelectedTeam();
    if (!teamName) {
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
    const teamName = getSelectedTeam();
    if (!teamName) return;

    const team = getTeam(teamName);
    if (!team) return;

    const shareData = {
        teamName: teamName,
        roster: team.roster.map(p => {
            const base = {
                name: p.name,
                is_captain: p.is_captain,
                is_goalkeeper: p.is_goalkeeper
            };

            if (document.getElementById('share-times').checked) {
                base.field_time = p.field_time;
            } else {
                base.field_time = 0;
            }

            return base;
        })
    };

    if (document.getElementById('share-rotation').checked) {
        shareData.rotation_history = team.rotation_history;
    }

    if (document.getElementById('share-events').checked) {
        shareData.event_history = team.event_history;
    }

    if (document.getElementById('share-quarters').checked) {
        shareData.gameclock_elapsed = team.gameclock.elapsed;
    }

    shareData.controls = team.controls;

    const compressed = compressData(JSON.stringify(shareData));
    const encodedData = encodeURIComponent(compressed);
    const shareUrl = `${window.location.origin}${window.location.pathname}?data=${encodedData}`;

    navigator.clipboard.writeText(shareUrl).then(() => {
        if (confirm("Share link copied to clipboard!\n\nNow redirecting you to tinyurl.com - post your link there for a more shareable URL")) {
            window.open('https://tinyurl.com', '_blank');
        }
        closeShareModal();
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        if (confirm("Share link copied to clipboard!\n\nNow redirecting you to tinyurl.com - post your link there for a more shareable URL")) {
            window.open('https://tinyurl.com', '_blank');
        }
        closeShareModal();
    });
}

function closeShareModal() {
    document.getElementById('share-modal').style.display = 'none';
}

function compressData(jsonString) {
    const compressed = jsonString
        .replace(/\s+/g, '')
        .replace(/"teamName":/g, '"tn":')
        .replace(/"roster":/g, '"ro":')
        .replace(/"rotation_history":/g, '"rh":')
        .replace(/"event_history":/g, '"eh":')
        .replace(/"gameclock_elapsed":/g, '"ge":')
        .replace(/"controls":/g, '"ct":')
        .replace(/"rotation_time":/g, '"rt":')
        .replace(/"notifications":/g, '"nf":')
        .replace(/"field_time":/g, '"ft":')
        .replace(/"is_captain":/g, '"ic":')
        .replace(/"is_goalkeeper":/g, '"ig":')
        .replace(/"event_type":/g, '"et":')
        .replace(/"player":/g, '"p":')
        .replace(/"quarter":/g, '"q":')
        .replace(/"time_in":/g, '"ti":')
        .replace(/"time_out":/g, '"to":')
        .replace(/"duration":/g, '"d":')
        .replace(/"timestamp":/g, '"ts":')
        .replace(/"name":/g, '"n":')
        .replace(/"time":/g, '"tm":')
        .replace(/"team":/g, '"te":');

    return btoa(compressed);
}

function decompressData(compressedData) {
    try {
        const compressed = atob(compressedData);
        const restored = compressed
            .replace(/"tn":/g, '"teamName":')
            .replace(/"ro":/g, '"roster":')
            .replace(/"rh":/g, '"rotation_history":')
            .replace(/"eh":/g, '"event_history":')
            .replace(/"ge":/g, '"gameclock_elapsed":')
            .replace(/"ct":/g, '"controls":')
            .replace(/"rt":/g, '"rotation_time":')
            .replace(/"nf":/g, '"notifications":')
            .replace(/"ft":/g, '"field_time":')
            .replace(/"ic":/g, '"is_captain":')
            .replace(/"ig":/g, '"is_goalkeeper":')
            .replace(/"et":/g, '"event_type":')
            .replace(/"p":/g, '"player":')
            .replace(/"q":/g, '"quarter":')
            .replace(/"ti":/g, '"time_in":')
            .replace(/"to":/g, '"time_out":')
            .replace(/"d":/g, '"duration":')
            .replace(/"ts":/g, '"timestamp":')
            .replace(/"n":/g, '"name":')
            .replace(/"tm":/g, '"time":')
            .replace(/"te":/g, '"team":');

        return JSON.parse(restored);
    } catch (e) {
        console.error('v4 decompression failed:', e);
        return null;
    }
}

// v3 decompression for backward compatibility
function decompressV3Data(compressedData) {
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
        return null;
    }
}

function convertV3Import(v3Data) {
    const teamData = createTeamData();

    // Convert v3 player format to v4
    if (v3Data.team && Array.isArray(v3Data.team)) {
        teamData.roster = v3Data.team.map(p => ({
            id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: p.name,
            is_captain: false,
            is_goalkeeper: false,
            active: false,
            field_time: p.totalTime || 0,
            session_start: null
        }));

        // Extract rotation history from per-player logs
        v3Data.team.forEach(p => {
            if (p.rotationLog) {
                p.rotationLog.forEach(log => {
                    teamData.rotation_history.push({
                        player: p.name,
                        quarter: log.quarter || '',
                        time_in: log.in,
                        time_out: log.out,
                        duration: log.duration
                    });
                });
            }
        });
    }

    // Convert events
    if (v3Data.events && Array.isArray(v3Data.events)) {
        teamData.event_history = v3Data.events.map(e => ({
            event_type: e.type,
            player: e.player,
            team: e.team,
            quarter: e.quarter,
            time: e.time,
            timestamp: e.timestamp
        }));
    }

    // Convert quarter clocks
    if (v3Data.quarterClocks) {
        teamData.gameclock.elapsed = v3Data.quarterClocks;
    }

    return { teamName: v3Data.teamName, teamData };
}

// ===== Import =====

function checkForImportData() {
    const urlParams = new URLSearchParams(window.location.search);
    let importParam = urlParams.get('data') || urlParams.get('import');

    if (!importParam) return;

    try {
        let parsed = null;
        let isV3 = false;

        // Try v4 format first
        parsed = decompressData(decodeURIComponent(importParam));

        // Try v3 format
        if (!parsed) {
            parsed = decompressV3Data(decodeURIComponent(importParam));
            if (parsed) isV3 = true;
        }

        // Try plain base64 JSON
        if (!parsed) {
            try {
                parsed = JSON.parse(atob(importParam));
                if (parsed.team) isV3 = true;
            } catch (e) { /* ignore */ }
        }

        if (parsed) {
            let previewTeamName, previewEvents;

            if (isV3) {
                const converted = convertV3Import(parsed);
                pendingImportData = {
                    teamName: converted.teamName,
                    teamData: converted.teamData,
                    isV3: true
                };
                previewTeamName = converted.teamName;
                previewEvents = converted.teamData.event_history || [];
            } else {
                pendingImportData = { raw: parsed };
                previewTeamName = parsed.teamName;
                previewEvents = parsed.event_history || [];
            }

            // Update page title with incoming share data
            if (previewTeamName) {
                const teamScore = previewEvents.filter(e =>
                    (e.event_type === 'goal' || e.event_type === 'penalty') && e.team === 'team'
                ).length;
                const otherScore = previewEvents.filter(e =>
                    (e.event_type === 'goal' || e.event_type === 'penalty') && e.team === 'other'
                ).length;
                document.title = `${teamScore}:${otherScore} ${previewTeamName} | Soccer Timer`;
                document.getElementById('team-title').textContent = `${previewTeamName} Time Tracker`;
            }

            document.getElementById('import-modal').style.display = 'block';
        } else {
            throw new Error('Invalid data format');
        }
    } catch (e) {
        console.error('Invalid import data:', e);
        alert('Invalid or corrupted share link. Please ask for a new link.');
        cleanImportUrl();
    }
}

function confirmImport() {
    if (!pendingImportData) return;

    let teamName, teamData;

    if (pendingImportData.isV3) {
        teamName = pendingImportData.teamName;
        teamData = pendingImportData.teamData;
    } else {
        const raw = pendingImportData.raw;
        teamName = raw.teamName;

        teamData = createTeamData();
        if (raw.controls) {
            teamData.controls = raw.controls;
        }

        if (raw.roster) {
            teamData.roster = raw.roster.map(p => ({
                id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                name: p.name,
                is_captain: p.is_captain || false,
                is_goalkeeper: p.is_goalkeeper || false,
                active: false,
                field_time: p.field_time || 0,
                session_start: null
            }));
        }

        if (raw.rotation_history) {
            teamData.rotation_history = raw.rotation_history;
        }

        if (raw.event_history) {
            teamData.event_history = raw.event_history;
        }

        if (raw.gameclock_elapsed) {
            teamData.gameclock.elapsed = raw.gameclock_elapsed;
        }
    }

    saveTeam(teamName, teamData);
    setSelectedTeam(teamName);

    pendingImportData = null;
    cleanImportUrl();
    document.getElementById('import-modal').style.display = 'none';
    alert(`Team "${teamName}" imported successfully!`);
    renderAll();
}

function cancelImport() {
    pendingImportData = null;
    cleanImportUrl();
    document.getElementById('import-modal').style.display = 'none';
}

function cleanImportUrl() {
    const url = new URL(window.location);
    url.searchParams.delete('import');
    url.searchParams.delete('data');
    window.history.replaceState({}, '', url);
}

// ===== UI Preferences =====

function loadPreferences() {
    // Sound
    const soundEnabled = getPref('soundEnabled', true);
    document.getElementById('sound-status').textContent = soundEnabled ? '🔊' : '🔇';

    // Controls collapsed
    if (getPref('controlsCollapsed', false)) {
        document.getElementById('collapsible-content').classList.add('collapsed');
        document.getElementById('collapse-toggle').textContent = '🔽';
    }

    // Rotation history collapsed
    const rotCollapsed = getPref('rotationHistoryCollapsed', true);
    const rotContent = document.getElementById('rotation-log');
    const rotToggle = document.getElementById('rotation-toggle');
    if (rotCollapsed) {
        rotContent.classList.add('collapsed');
        rotToggle.textContent = '🔽';
    } else {
        rotContent.classList.remove('collapsed');
        rotToggle.textContent = '🔼';
    }
}

// ===== Initialization =====

function initQuarterButtons() {
    document.querySelectorAll('.quarter-button').forEach(button => {
        button.addEventListener('click', () => {
            const quarter = button.getAttribute('data-quarter');
            onQuarterChange(quarter);
        });
    });
}

function init() {
    loadPreferences();
    initQuarterButtons();

    // Request notification permission
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

    // Enter key in player name input
    document.getElementById('new-player-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addPlayerFromModal();
    });

    // Close modals on backdrop click
    window.addEventListener('click', (e) => {
        document.querySelectorAll('.modal').forEach(modal => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    // Initial render
    renderAll();

    // Check for import data in URL
    checkForImportData();
}

document.addEventListener('DOMContentLoaded', init);
