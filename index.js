// vers 1.1.3

const format = require('./format.js');

const BossId = [781, 3000]; // Lakan NM

//MessageId: BossAction
const BossMessages = {
	9781043: 1192035708,	// Lakan has noticed you.
	9781044: 1192037407,	// Lakan is trying to take you on one at a time.
	9781045: 1192035605	// Lakan intends to kill all of you at once.
};

const BossActions = {
	1192035448: {msg: 'Get out',				msgParty: ''}, // Begone purple
	1192035449: {msg: 'Get in',				msgParty: ''}, // Begone orange
	1192035705: {msg: 'Dodge + plague/regress',		msgParty: 'ring'}, // Shield
	// > 30%
	1192035708: {msg: 'Debuff (closest)',			msgParty: 'D',	next: 1192037407,	prev: 1192035605}, // Debuff
	1192037407: {msg: 'Spread', 				msgParty: 'S',	next: 1192035605,	prev: 1192035708}, // Spread aka Circles
	1192035605: {msg: 'Gather + cleanse', 			msgParty: 'GC',	next: 1192035708,	prev: 1192037407}, // Gather
	// < 30%
	1192035709: {msg: 'Debuff (furthest)',			msgParty: 'D',	next: 1192035606}, // Debuff
	1192037409: {msg: 'Gather',				msgParty: 'G',	next: 1192035709}, // Spread aka Circles
	1192035606: {msg: 'Gather + no cleanse',		msgParty: 'G',	next: 1192037409}, // Gather
	//
	'ShieldWarning': {msg: 'Ring soon, get ready to dodge',	msgParty: 'ring'},
};

const InversedAction = {
	1192035708: 1192035709,
	1192037407: 1192037409,
	1192035605: 1192035606
};

const ShieldWarningTrigger = 0.35; //boss hp%

module.exports = function VSNMLakanGuide(dispatch) {

	let enabled = true,
		sendToParty = false,
		sendToPartyLong = false,
		showNextMechanicMessage = true,
		slash = true,
		command = true,
		boss,
		shieldWarned,
		timerNextMechanic, 
		lastAction,
		isReversed,
		supressNotice;

	// slash support
	try {
		const Slash = require('slash');
		const slash = new Slash(dispatch);
		slash.on('vsnm-lakan', args => toggleModule());
		slash.on('vsnmlakan', args => toggleModule());
		slash.on('vsnm-lakan.party', args => toggleSentMessages());
		slash.on('vsnmlakan.party', args => toggleSentMessages());
		slash.on('vsnm-lakan.party.long', args => toggleSentMessagesLong());
		slash.on('vsnmlakan.party.long', args => toggleSentMessagesLong());
	} catch (e) {
		slash = false;
	}
	// command support
	if (!slash) {
		try {
			const Command = require('command');
			const command = Command(dispatch);
			command.add('vsnm-lakan', () => {
				toggleModule();
			});
			command.add('vsnm-lakan.party', () => {
				toggleSentMessages();
			});
			command.add('vsnm-lakan.party.long', () => {
				toggleSentMessagesLong();
			});
		} catch (e) {
			command = false;
		}
	}
	if (!slash && !command) {
		const chatHook = event => {		
			let command = format.stripTags(event.message).split(' ');
			if (['!vsnm-lakan', '!vsnmlakan'].includes(command[0].toLowerCase())) {
				toggleModule();
				return false;
			} else if (['!vsnm-lakan.party', '!vsnmlakan.party'].includes(command[0].toLowerCase())) {
				toggleSentMessages();
				return false;
			} else if (['!vsnm-lakan.party.long', '!vsnmlakan.party.long'].includes(command[0].toLowerCase())) {
				toggleSentMessagesLong();
				return false;
			}
		}
		dispatch.hook('C_CHAT', 1, chatHook)	
		dispatch.hook('C_WHISPER', 1, chatHook)
	}

	function toggleModule() {
		enabled = !enabled;
		sendToPartyLong = false;
		sendToParty = false;
		systemMessage((enabled ? 'enabled' : 'disabled'));
	}

	function toggleSentMessages() {
		if (!enabled) {
			systemMessage('Enable the mod first');
			return;
		}
		sendToPartyLong = false;
		sendToParty = !sendToParty;
		systemMessage((sendToParty ? 'Messages will be sent to the party shortened' : 'Only you will see messages'));
	}

	function toggleSentMessagesLong() {
		if (!sendToParty || !enabled) {
			systemMessage('Enable party messages first');
			return;
		}
		sendToPartyLong = !sendToPartyLong;
		systemMessage((sendToPartyLong ? 'Messages will be sent to the party complete' : (sendToParty ? 'Messages will be sent to the party shortened' : 'Only you will see messages')));
	}

	dispatch.hook('S_CHAT', 1, (event) => {	
		if (!enabled || !boss || event.channel != 21 || format.stripTags(event.message) != supressNotice) return;	
		supressNotice = null;
		return false;
	})

	dispatch.hook('S_DUNGEON_EVENT_MESSAGE', 1, (event) => {	
		if (!enabled || !boss) return;
		
		let msgId = parseInt(event.message.replace('@dungeon:', ''));
		if (BossMessages[msgId]) {
			if (timerNextMechanic) clearTimeout(timerNextMechanic);
			sendMessage(BossMessages[msgId], 'Next: ');
			(bossHealth() > 0.5) ? isReversed = false : isReversed = true;
		}
	})
	
	function bossHealth() {
		return (boss.curHp / boss.maxHp);
	}
	
	dispatch.hook('S_BOSS_GAGE_INFO', 2, (event) => {
		if (!enabled) return;
		
		if (event.huntingZoneId === BossId[0] && event.templateId === BossId[1]) {
			boss = event;
		}
		
		if (boss) {
			let bossHp = bossHealth();
			if (bossHp > ShieldWarningTrigger) {
				shieldWarned = false;
			} else if (bossHp <= ShieldWarningTrigger && !shieldWarned) {
				sendMessage('ShieldWarning');
				shieldWarned = true;
			} else if (bossHp <= 0) {
				boss = undefined;
				lastAction = undefined;
				isReversed = false;
				clearTimeout(timerNextMechanic);
			}
		}
	 })
			
	dispatch.hook('S_ACTION_STAGE', 1, (event) => {
		if (!enabled || !boss) return;
		
		if (boss.id - event.source == 0) {
			 if (BossActions[event.skill]) {
				sendMessage(event.skill);
				
				if (!showNextMechanicMessage) return;

				if (isReversed && BossActions[event.skill].prev) {					   // 50% to 30%
					startTimer(BossActions[event.skill].prev);
					lastAction = event.skill;
				} else if (BossActions[event.skill].next) {							  // 100% to 50% and 30% to 0%
					startTimer(BossActions[event.skill].next);
					lastAction = event.skill;
				} else if (event.skill == 1192035705 && lastAction) {								  // Shield (Mechanics inversing)
					startTimer(InversedAction[lastAction]);
				}
			}			
		}
	})
	
	function startTimer(actionId) {
		if (timerNextMechanic) clearTimeout(timerNextMechanic);
		timerNextMechanic = setTimeout(() => {
			sendMessage(actionId, 'Next: ');
			timerNextMechanic = null;
		}, 8000);	
	}

	function sendMessage(actionId, prepend = '') {
		if (!enabled) return;
		dispatch.toClient('S_CHAT', 1, {
			channel: 21, //21 = p-notice, 1 = party
			authorName: 'DG-Guide',
			message: prepend+BossActions[actionId].msg
		});
		if (sendToParty && sendToPartyLong) {
			supressNotice = prepend+BossActions[actionId].msg;
			dispatch.toServer('C_CHAT', 1, {
				channel: 21, //21 = p-notice, 1 = party
				message: prepend+BossActions[actionId].msg
			});
		} else if (sendToParty) {
			if (typeof BossActions[actionId].msgParty !== 'string') return;
			if (BossActions[actionId].msgParty.length == 0) return;
			supressNotice = BossActions[actionId].msgParty;
			setTimeout(function () {
				dispatch.toServer('C_CHAT', 1, {
					channel: 21, //21 = p-notice, 1 = party
					message: BossActions[actionId].msgParty
				});
			}, 1000);
		}		
	}	
		
	function systemMessage(msg) {
		dispatch.toClient('S_CHAT', 1, {
			channel: 24, //system channel
			authorName: '',
			message: ' (VSNM-Lakan-Guide) ' + msg
		});
	}

}
