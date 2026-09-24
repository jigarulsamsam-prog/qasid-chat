let conversations = [];
let contacts = [];
const messages = {};
const messageListeners = new Set();
const seenMessageCounts = new Map();
const notifiedMessageIds = new Set();
let notifications = [];
const gupShupStatuses = new Map();
const gupShupNotifications = new Map();
let gupShupRequestListenerAttached = false;
let currentProfileImage = "";
let publicMessageListenerAttached = false;
const seenPublicMessageIds = new Set();
const publicPresenceStates = new Map();
const publicPresenceEvents = [];
let publicPresenceInitialized = false;

const firebaseConfig = {
  apiKey: "AIzaSyC35ZCV2MRxKAvpRdVZC_kT3YrMyGvZtHc",
  authDomain: "qasid-85586.firebaseapp.com",
  databaseURL: "https://qasid-85586-default-rtdb.firebaseio.com",
  projectId: "qasid-85586",
  storageBucket: "qasid-85586.firebasestorage.app",
  messagingSenderId: "548433282631",
  appId: "1:548433282631:web:71329258544afaba1d9362"
};

let firebaseUser = null;
let database = null;
let storage = null;
let firebaseAuth = null;
let authMode = "login";
let onlineUsersListenerAttached = false;

let activeScreen = "inbox-screen";
let activeContact = null;
let focusedIndex = 0;
let selectedMessageIndex = -1;
let replyTarget = null;
let viewedContact = null;
let voiceRecorder = null;
let voiceChunks = [];

let welcomeTimer = null;
let welcomeAudioContext = null;
let welcomeAudioElement = null;
let welcomeAudioStarted = false;
let welcomeStarted = false;

const $ = (selector) => document.querySelector(selector);

const screens = [
  "auth-screen",
  "welcome-screen",
  "home-screen",
  "inbox-screen",
  "chat-screen",
  "contacts-screen",
  "profile-view-screen",
  "public-screen",
  "profile-screen",
  "notifications-screen"
];

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function chatKey(firstUid, secondUid) {
  return [firstUid, secondUid].sort().join("_");
}

function usernameKey(username) {
  return (username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function renderAvatar(user, name) {
  return user && user.profileImage
    ? `<img class="avatar-image" src="${user.profileImage}" alt="">`
    : initials(name);
}

function messagePreview(message) {
  if (message.text) return message.text;
  if (message.attachment && message.attachment.kind === "photo") return "Photo message";
  if (message.attachment && message.attachment.kind === "voice") return "Voice message";
  return "New message";
}

function formatDateTime(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getNotificationPreview(notification) {
  if (!notification) return "No details";

  if (notification.kind === "gup-shup-request") {
    const sentAt = notification.sentAt || notification.createdAt;
    const responseAt = notification.respondedAt || notification.updatedAt;
    const statusLabel = notification.status === "accepted"
      ? "Accepted"
      : notification.status === "rejected"
        ? "Rejected"
        : "Sent";

    return `${statusLabel}: ${formatDateTime(responseAt || sentAt)}${sentAt ? ` • Sent: ${formatDateTime(sentAt)}` : ""}`;
  }

  if (notification.kind === "gup-shup-response") {
    return `${notification.text}${notification.respondedAt ? ` • ${formatDateTime(notification.respondedAt)}` : ""}`;
  }

  return notification.text || "No details";
}

function renderConversations() {
  const unreadTotal = conversations.reduce(
    (total, conversation) => total + (conversation.unread || 0),
    0
  );

  $("#unread-count").textContent = String(unreadTotal);

  const notificationCount = $("#notification-count");

  if (notificationCount) {
    notificationCount.textContent = String(unreadTotal);
    notificationCount.hidden = unreadTotal === 0;
  }

  $("#conversation-list").innerHTML = conversations.map((conversation, index) => `
    <button
      class="list-row ${index === focusedIndex ? "is-focused" : ""}"
      data-contact="${conversation.id}"
      type="button"
    >
      <span class="avatar">${renderAvatar(conversation, conversation.name)}</span>
      <span class="row-copy">
        <span class="row-name">${conversation.name}</span>
        <span class="row-preview">${conversation.preview || "No messages yet"}</span>
      </span>
      <span class="row-time">${conversation.time || ""}</span>
      ${conversation.unread ? `<span class="unread-badge">${conversation.unread}</span>` : ""}
    </button>
  `).join("");

  $("#conversation-list")
    .querySelectorAll("button")
    .forEach((button) => {
      button.addEventListener("click", () =>
        openChat(button.dataset.contact)
      );
    });
}

function renderNotifications() {
  const list = $("#notifications-list");

  if (!list) return;

  const notificationCount = $("#notification-count");
  const unreadTotal = conversations.reduce(
    (total, conversation) => total + (conversation.unread || 0),
    0
  );
  const requestTotal = Array.from(gupShupNotifications.values())
    .filter((notification) => notification.kind === "gup-shup-request" && notification.status === "pending")
    .length;

  if (notificationCount) {
    notificationCount.textContent = String(unreadTotal + requestTotal);
    notificationCount.hidden = unreadTotal + requestTotal === 0;
  }

  const groupedPrivate = new Map();
  const groupedNotifications = [];

  [...gupShupNotifications.values(), ...notifications].forEach((notification) => {
    if (notification.kind === "public") {
      groupedNotifications.push({
        ...notification,
        count: 1
      });
      return;
    }

    const groupKey = notification.kind === "gup-shup-request" || notification.kind === "gup-shup-response"
      ? notification.id
      : notification.contactId || notification.id;
    const existing = groupedPrivate.get(groupKey);

    if (existing) {
      existing.count += 1;
      return;
    }

    const grouped = {
      ...notification,
      count: 1
    };

    groupedPrivate.set(groupKey, grouped);
    groupedNotifications.push(grouped);
  });

  list.innerHTML = groupedNotifications.map((notification) => `
    <div class="list-row notification-row" data-id="${notification.id || ""}" data-kind="${notification.kind || "private"}" data-contact="${notification.contactId || ""}">
      <span class="avatar">${renderAvatar(notification, notification.name)}</span>
      <span class="row-copy">
        <span class="row-name">${notification.kind === "gup-shup-request" ? "Gup Shup Request" : notification.name}</span>
        ${notification.kind === "gup-shup-request" ? `<strong class="request-sender">${notification.name}</strong>` : ""}
        <span class="row-preview">${getNotificationPreview(notification)}</span>
      </span>
      <span class="row-time">${notification.time || formatDateTime(notification.sentAt || notification.respondedAt || notification.createdAt)}</span>
      ${notification.kind !== "public" ? `<span class="notification-badge">${notification.count}</span>` : ""}
      ${notification.kind === "gup-shup-request" && notification.status === "pending" ? `
        <button class="request-action accept-request" data-request-action="accept" type="button">Accept</button>
        <button class="request-action reject-request" data-request-action="reject" type="button">Reject</button>
      ` : ""}
    </div>
  `).join("") || '<p class="row-preview">No new notifications.</p>';

  list.querySelectorAll(".notification-row").forEach((row) => {
    row.addEventListener("click", () => {
      const actionButton = row.querySelector("[data-request-action]");
      if (actionButton) return;

      const notification = gupShupNotifications.get(row.dataset.id) ||
        notifications.find((item) => item.id === row.dataset.id);
      if (!notification) return;

      if (notification.kind === "public") {
        showScreen("public-screen");
        notifications = notifications.filter((item) => item.id !== notification.id);
      } else if (notification.kind === "private") {
        openChat(row.dataset.contact);
      }

      renderNotifications();
    });
  });

  list.querySelectorAll("[data-request-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".notification-row");
      const notification = gupShupNotifications.get(row.dataset.id) ||
        notifications.find((item) => item.id === row.dataset.id);
      if (notification) respondToGupShupRequest(notification, button.dataset.requestAction);
    });
  });
}

function renderContacts() {
  $("#contact-list").innerHTML = contacts.map((contact, index) => `
    <button
      class="list-row ${index === focusedIndex ? "is-focused" : ""}"
      data-contact="${contact.id}"
      type="button"
    >
      <span class="avatar">${renderAvatar(contact, contact.name)}</span>
      <span class="row-copy">
        <span class="row-name"><span class="presence-dot ${contact.online ? "is-online" : ""}"></span>${contact.name}</span>
        <span class="row-preview">@${contact.username || contact.name}</span>
      </span>
    </button>
  `).join("");

  $("#contact-list")
    .querySelectorAll("button")
    .forEach((button) => {
      button.addEventListener("click", () =>
        openProfile(button.dataset.contact)
      )
    });
}

function openProfile(contactId) {
  const contact = contacts.find((item) => item.id === contactId);

  if (!contact) return;

  viewedContact = contact;
  $("#viewed-profile-name").textContent = contact.name;
  $("#viewed-profile-state").textContent = contact.online ? "Online" : "Offline";
  $("#viewed-profile-dot").classList.toggle("is-offline", !contact.online);
  $("#viewed-profile-image").src = contact.profileImage || "assets/welcome.png";
  updateGupShupButton(contactId);
  loadGupShupStatus(contactId);
  showScreen("profile-view-screen");
  $("#viewed-profile-message").focus();
}

function updateGupShupButton(contactId) {
  const button = $("#viewed-profile-message");
  const label = $("#gup-shup-label");
  const actions = $("#gup-shup-request-actions");
  const acceptButton = $("#accept-gup-shup-request");
  const rejectButton = $("#reject-gup-shup-request");
  const status = gupShupStatuses.get(contactId) ||
    localStorage.getItem("qasid-gup-shup-status-" + contactId) || "none";

  if (!button) return;

  const pendingIncomingRequest = [...gupShupNotifications.values()].find(
    (notification) =>
      notification.kind === "gup-shup-request" &&
      notification.senderId === contactId &&
      notification.status === "pending"
  );

  if (label) label.textContent = "Gup Shup Request";

  if (pendingIncomingRequest) {
    button.disabled = true;
    button.textContent = "Pending";
    if (actions) actions.hidden = false;
    if (acceptButton) acceptButton.dataset.contactId = contactId;
    if (rejectButton) rejectButton.dataset.contactId = contactId;
    if (acceptButton && rejectButton) {
      acceptButton.onclick = () => respondToGupShupRequest(pendingIncomingRequest, "accept");
      rejectButton.onclick = () => respondToGupShupRequest(pendingIncomingRequest, "reject");
    }
    return;
  }

  if (actions) actions.hidden = true;
  button.disabled = status === "pending";
  button.textContent = status === "pending"
    ? "Your request is pending"
    : status === "accepted"
      ? "Message"
      : "Send";
}

function getCurrentUsername() {
  return $("#current-username").textContent.replace(/^@/, "") || "User";
}

function loadGupShupStatus(contactId) {
  if (!database || !firebaseUser) return Promise.resolve();

  return Promise.all([
    database
      .ref("gupShupRequestsBySender/" + firebaseUser.uid)
      .orderByChild("receiverId")
      .equalTo(contactId)
      .once("value"),
    database
      .ref("gupShupRequests/" + firebaseUser.uid)
      .orderByChild("senderId")
      .equalTo(contactId)
      .once("value")
  ]).then(([outgoingSnapshot, incomingSnapshot]) => {
    const requests = [];

    outgoingSnapshot.forEach((item) => {
      const request = item.val();
      if (request && request.status) requests.push(request);
    });

    incomingSnapshot.forEach((item) => {
      const request = item.val();
      if (request && request.status) requests.push(request);
    });

    if (!requests.length) return;

    const latestRequest = requests.reduce((latest, request) => {
      if (!latest || (request.createdAt || 0) > (latest.createdAt || 0)) {
        return request;
      }
      return latest;
    }, null);

    if (latestRequest && latestRequest.status) {
      setGupShupStatus(contactId, latestRequest.status);
    }
  }).then(() => {
    updateGupShupButton(contactId);
  });
}

function setGupShupStatus(contactId, status) {
  if (!contactId || !status) return;

  gupShupStatuses.set(contactId, status);
  localStorage.setItem("qasid-gup-shup-status-" + contactId, status);
}

function sendGupShupRequest() {
  if (!database || !firebaseUser || !viewedContact) return;

  const receiver = viewedContact;
  const requestRef = database.ref("gupShupRequests/" + receiver.id).push();
  const request = {
    senderId: firebaseUser.uid,
    senderName: getCurrentUsername(),
    receiverId: receiver.id,
    receiverName: receiver.name,
    status: "pending",
    sentAt: firebase.database.ServerValue.TIMESTAMP,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };

  const updates = {};
  updates["gupShupRequests/" + receiver.id + "/" + requestRef.key] = request;
  updates["gupShupRequestsBySender/" + firebaseUser.uid + "/" + requestRef.key] = request;
  updates["notifications/" + receiver.id + "/" + requestRef.key] = {
    kind: "gup-shup-request",
    requestId: requestRef.key,
    senderId: firebaseUser.uid,
    name: getCurrentUsername(),
    text: "Gup Shup request bheji hai.",
    status: "pending",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };

  gupShupStatuses.set(receiver.id, "pending");
  localStorage.setItem("qasid-gup-shup-status-" + receiver.id, "pending");
  updateGupShupButton(receiver.id);

  database.ref().update(updates).then(() => {
    updateGupShupButton(receiver.id);
  }).catch((error) => {
    gupShupStatuses.delete(receiver.id);
    localStorage.removeItem("qasid-gup-shup-status-" + receiver.id);
    updateGupShupButton(receiver.id);
    const status = $("#profile-status");
    if (status) status.textContent = "Request send nahi hui: " + error.message;
  });
}

function respondToGupShupRequest(notification, action) {
  if (!database || !firebaseUser || !notification.requestId) return;

  const status = action === "accept" ? "accepted" : "rejected";
  const updates = {};
  const respondedAt = firebase.database.ServerValue.TIMESTAMP;
  updates["gupShupRequests/" + firebaseUser.uid + "/" + notification.requestId + "/status"] = status;
  updates["gupShupRequests/" + firebaseUser.uid + "/" + notification.requestId + "/respondedAt"] = respondedAt;
  updates["gupShupRequestsBySender/" + notification.senderId + "/" + notification.requestId + "/status"] = status;
  updates["gupShupRequestsBySender/" + notification.senderId + "/" + notification.requestId + "/respondedAt"] = respondedAt;
  updates["notifications/" + firebaseUser.uid + "/" + notification.requestId + "/status"] = status;

  const responseRef = database.ref("notifications/" + notification.senderId).push();
  updates["notifications/" + notification.senderId + "/" + responseRef.key] = {
    kind: "gup-shup-response",
    requestId: notification.requestId,
    contactId: firebaseUser.uid,
    name: getCurrentUsername(),
    text: status === "accepted" ? "Gup Shup request accept ho gayi." : "Gup Shup request reject ho gayi.",
    status,
    respondedAt,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };

  setGupShupStatus(notification.senderId, status);
  if (viewedContact && viewedContact.id === notification.senderId) {
    updateGupShupButton(notification.senderId);
  }

  database.ref().update(updates).then(() => {
    gupShupNotifications.delete(notification.id);
    renderNotifications();
  }).catch((error) => {
    console.error("Could not respond to Gup Shup request.", error);
  });
}

function listenForOwnGupShupRequests() {
  if (!database || !firebaseUser || gupShupRequestListenerAttached) return;

  gupShupRequestListenerAttached = true;
  database.ref("gupShupRequestsBySender/" + firebaseUser.uid).on("value", (snapshot) => {
    snapshot.forEach((item) => {
      const request = item.val();
      if (!request.receiverId || !request.status) return;

      gupShupStatuses.set(request.receiverId, request.status);
      localStorage.setItem(
        "qasid-gup-shup-status-" + request.receiverId,
        request.status
      );

      if (viewedContact && viewedContact.id === request.receiverId) {
        updateGupShupButton(request.receiverId);
      }
    });
  });
}

function listenForGupShupNotifications() {
  if (!database || !firebaseUser) return;

  database.ref("gupShupRequests/" + firebaseUser.uid).on("value", (snapshot) => {
    snapshot.forEach((item) => {
      const request = item.val();
      if (!request) return;

      if (request.status !== "pending") {
        gupShupNotifications.delete(item.key);
        setGupShupStatus(request.senderId, request.status);
        if (viewedContact && viewedContact.id === request.senderId) {
          updateGupShupButton(request.senderId);
        }
        return;
      }

      gupShupNotifications.set(item.key, {
        id: item.key,
        kind: "gup-shup-request",
        requestId: item.key,
        senderId: request.senderId,
        name: request.senderName,
        text: "Gup Shup request bheji hai.",
        status: request.status,
        sentAt: request.sentAt || request.createdAt,
        respondedAt: request.respondedAt,
        time: formatDateTime(request.sentAt || request.createdAt)
      });
    });
    renderNotifications();
  });

  database.ref("notifications/" + firebaseUser.uid).on("value", (snapshot) => {
    snapshot.forEach((item) => {
      const notification = item.val();
      if (notification.kind === "gup-shup-response") {
        gupShupNotifications.set(item.key, {
          ...notification,
          id: item.key,
          respondedAt: notification.respondedAt || notification.createdAt
        });

        if (notification.kind === "gup-shup-response" && notification.contactId) {
          setGupShupStatus(notification.contactId, notification.status);
        }
      }
    });

    renderNotifications();
    if (viewedContact) updateGupShupButton(viewedContact.id);
  });
}

function renderMessages() {
  const contact = contacts.find(
    (item) => item.id === activeContact
  );

  const contactMessages =
    messages[chatKey(firebaseUser.uid, activeContact)] || [];

  $("#chat-title").textContent =
    contact ? contact.name : "Chat";

  $("#message-list").innerHTML =
    contactMessages.map((message, index) => `
      <div class="bubble ${message.from} ${index === selectedMessageIndex ? "is-selected" : ""}" data-message-index="${index}" tabindex="-1">
        ${message.replyTo ? `<div class="reply-quote">${message.replyTo.text}</div>` : ""}
        ${message.attachment && message.attachment.kind === "photo" ? `<img class="message-photo" src="${message.attachment.url}" alt="Photo message">` : ""}
        ${message.attachment && message.attachment.kind === "voice" ? `<audio class="message-voice" controls preload="metadata" src="${message.attachment.url}"></audio>` : ""}
        ${message.text || ""}
        <span class="bubble-time">
          ${message.time}
          ${message.from === "me" ? `<span class="message-status ${message.readBy && message.readBy[activeContact] ? "is-read" : ""}" aria-label="${message.readBy && message.readBy[activeContact] ? "Read" : "Sent"}">${message.readBy && message.readBy[activeContact] ? "✓✓" : "✓"}</span>` : ""}
        </span>
      </div>
    `).join("") ||
    '<p class="row-preview">No messages yet. Say hello.</p>';

  $("#message-list").scrollTop =
    $("#message-list").scrollHeight;

  $("#message-list")
    .querySelectorAll("[data-message-index]")
    .forEach((messageElement) => {
      messageElement.addEventListener("click", () => {
        selectMessage(Number(messageElement.dataset.messageIndex));
      });
    });

  renderReplyPreview();
}

function selectMessage(index) {
  const contactMessages = messages[chatKey(firebaseUser.uid, activeContact)] || [];

  if (!contactMessages[index]) return;

  selectedMessageIndex = index;
  renderMessages();
}

function startReplyMode() {
  const contactMessages = messages[chatKey(firebaseUser.uid, activeContact)] || [];
  const message = contactMessages[selectedMessageIndex];

  if (!message) return;

  replyTarget = {
    id: message.id || "",
    text: message.text
  };
  renderReplyPreview();
  $("#message-input").focus();
}

function renderReplyPreview() {
  const preview = $("#reply-preview");
  const text = $("#reply-preview-text");

  if (!preview || !text) return;

  preview.hidden = !replyTarget;
  text.textContent = replyTarget ? replyTarget.text : "";
}

function cancelReply() {
  replyTarget = null;
  selectedMessageIndex = -1;
  renderMessages();
  $("#message-input").focus();
}

function toggleChatOptions() {
  if (activeScreen !== "chat-screen") return;

  const options = $("#chat-options");

  if (!options) return;

  options.hidden = !options.hidden;

  if (!options.hidden) {
    options.querySelector("button").focus();
  } else {
    $("#message-input").focus();
  }
}

function showScreen(screenId) {
  if (activeScreen === "public-screen" && screenId !== "public-screen") {
    setPublicPresence(false);
  }

  if (screenId !== "chat-screen") {
    activeContact = null;
  }

  activeScreen = screenId;

  screens.forEach((id) => {
    const screen = $("#" + id);

    if (screen) {
      screen.classList.toggle(
        "is-active",
        id === screenId
      );
    }
  });

  focusedIndex = 0;

  if (screenId === "inbox-screen") {
    renderConversations();
  }

  if (screenId === "contacts-screen") {
    renderContacts();
  }

  if (screenId === "home-screen") {
    focusHomeMenu();
  }
}

/* =========================
   WELCOME AUDIO
========================= */

function startWelcomeAudio() {
  if (welcomeAudioStarted) return;

  welcomeAudioElement = $("#welcome-audio");

  if (welcomeAudioElement) {
    welcomeAudioElement.currentTime = 0;
    welcomeAudioElement.volume = 0.45;

    const audioPlay = welcomeAudioElement.play();

    if (audioPlay) {
      audioPlay
        .then(() => {
          welcomeAudioStarted = true;

          setTimeout(() => {
            stopWelcomeAudio();
          }, 12000);
        })
        .catch(() => {
          startFallbackMelody();
        });
    }

    return;
  }

  startFallbackMelody();
}

function unlockWelcomeAudio() {
  const audio = $("#welcome-audio");

  if (!audio) return;

  audio.muted = true;

  const unlock = audio.play();

  if (unlock) {
    unlock
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      })
      .catch(() => {
        audio.muted = false;
      });
  }
}

function startFallbackMelody() {
  if (welcomeAudioStarted) return;

  try {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) return;

    welcomeAudioContext =
      new AudioContextClass();

    welcomeAudioContext.resume();

    welcomeAudioStarted = true;

    const notes = [
      261.63,
      329.63,
      392,
      523.25,
      392,
      329.63
    ];

    notes.forEach((frequency, index) => {
      const oscillator =
        welcomeAudioContext.createOscillator();

      const gain =
        welcomeAudioContext.createGain();

      const start =
        welcomeAudioContext.currentTime +
        index * 2;

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      gain.gain.setValueAtTime(
        0.0001,
        start
      );

      gain.gain.exponentialRampToValueAtTime(
        0.045,
        start + 0.08
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        start + 1.7
      );

      oscillator
        .connect(gain)
        .connect(
          welcomeAudioContext.destination
        );

      oscillator.start(start);
      oscillator.stop(start + 1.8);
    });
  } catch (error) {
    welcomeAudioContext = null;
  }
}

function stopWelcomeAudio() {
  if (welcomeAudioElement) {
    welcomeAudioElement.pause();
    welcomeAudioElement.currentTime = 0;
    welcomeAudioElement = null;
  }

  if (welcomeAudioContext) {
    welcomeAudioContext.close();
    welcomeAudioContext = null;
  }

  welcomeAudioStarted = false;
}

/* =========================
   WELCOME SCREEN
========================= */

function startWelcomeScreen() {
  if (welcomeStarted) return;

  welcomeStarted = true;

  clearInterval(welcomeTimer);

  const art = $("#welcome-art");
  const button = $("#lets-go-button");
  const countdown = $("#welcome-countdown");

  if (!art || !button || !countdown) {
    showScreen("home-screen");
    return;
  }

  showScreen("welcome-screen");

  art.classList.remove("welcome-blur");
  art.classList.remove("is-blurred");

  button.classList.remove("show-lets-go");
  button.classList.remove("is-ready");
  button.disabled = true;

  countdown.textContent = "Starting in 12";

  startWelcomeAudio();

  let seconds = 12;

  welcomeTimer = setInterval(() => {
    seconds--;

    countdown.textContent =
      seconds > 0
        ? "Starting in " + seconds
        : "";

    if (seconds <= 0) {
      clearInterval(welcomeTimer);

      art.classList.add("welcome-blur");
      art.classList.add("is-blurred");

      button.classList.add("show-lets-go");
      button.classList.add("is-ready");

      button.disabled = false;
      button.focus();
    }
  }, 1000);
}

function finishWelcome() {
  clearInterval(welcomeTimer);

  stopWelcomeAudio();

  const button = $("#lets-go-button");

  if (button) {
    button.classList.remove("show-lets-go");
    button.classList.remove("is-ready");
  }

  welcomeStarted = false;

  showScreen("home-screen");

  focusHomeMenu();
}

/* =========================
   HOME KEYPAD MENU
========================= */

function getHomeMenuButtons() {
  return Array.from(
    document.querySelectorAll(
      "#home-screen .menu-row"
    )
  );
}

function focusHomeMenu() {
  const buttons = getHomeMenuButtons();

  if (!buttons.length) return;

  focusedIndex = Math.max(
    0,
    Math.min(
      focusedIndex,
      buttons.length - 1
    )
  );

  buttons.forEach((button, index) => {
    button.classList.toggle(
      "is-focused",
      index === focusedIndex
    );
  });

  buttons[focusedIndex].focus();
}

function moveHomeFocus(direction) {
  const buttons = getHomeMenuButtons();

  if (!buttons.length) return;

  focusedIndex += direction;

  if (focusedIndex < 0) {
    focusedIndex = buttons.length - 1;
  }

  if (focusedIndex >= buttons.length) {
    focusedIndex = 0;
  }

  focusHomeMenu();
}

function selectHomeMenu() {
  const buttons = getHomeMenuButtons();

  if (!buttons.length) return;

  const button = buttons[focusedIndex];

  if (button) {
    button.click();
  }
}

/* =========================
   PUBLIC CHAT
========================= */

function renderPublicMessages(snapshot) {
  const publicMessages = [];

  snapshot.forEach((item) => {
    publicMessages.push(item.val());
  });

  $("#public-message-list").innerHTML =
    publicMessages.map((message) => `
      <div class="bubble ${
        message.sender === firebaseUser.uid
          ? "me"
          : "them"
      }">
        <strong>${message.username || "User"}</strong>
        <br>
        ${message.text}
        <span class="bubble-time">
          ${message.time || ""}
        </span>
      </div>
    `).join("") ||
    '<p class="row-preview">No public messages yet.</p>';

  $("#public-message-list").scrollTop =
    $("#public-message-list").scrollHeight;
}

function renderPublicPresenceEvents() {
  const list = $("#public-presence-list");

  if (!list) return;

  list.innerHTML = publicPresenceEvents
    .slice(-8)
    .map((event) => `<span class="presence-event ${event.type}">${event.name} ${event.type}</span>`)
    .join("");
}

function setPublicPresence(isInside) {
  if (!database || !firebaseUser) return;

  const presenceRef = database.ref(
    "users/" + firebaseUser.uid + "/publicOnline"
  );

  if (!isInside) {
    presenceRef.set(false);
    return;
  }

  presenceRef.onDisconnect().set(false);
  presenceRef.set(true);
}

function publicUserName(user) {
  return user.username || user.displayName || user.email || "User";
}

function listenForPublicMessages() {
  if (!database || publicMessageListenerAttached) return;

  publicMessageListenerAttached = true;

  database.ref("publicMessages").limitToLast(100).on("value", (snapshot) => {
    renderPublicMessages(snapshot);

    snapshot.forEach((item) => {
      const message = item.val();

      if (
        seenPublicMessageIds.has(item.key) ||
        message.sender === firebaseUser.uid
      ) {
        seenPublicMessageIds.add(item.key);
        return;
      }

      seenPublicMessageIds.add(item.key);
      notifications.unshift({
        id: item.key,
        kind: "public",
        name: message.username || "Public chat",
        text: message.text || "New public message",
        time: message.time || "",
        profileImage: message.profileImage || ""
      });
    });

    renderNotifications();
  });
}

function openMenu(menu) {
  if (menu === "public") {
    showScreen("public-screen");
    setPublicPresence(true);
    renderPublicPresenceEvents();
    listenForPublicMessages();
  }

  else if (menu === "private") {
    showScreen("contacts-screen");
  }

  else if (menu === "profile") {
    $("#profile-username").value =
      $("#current-username")
        .textContent
        .replace(/^@/, "");

    showScreen("profile-screen");
  }

  else if (menu === "notifications") {
    renderNotifications();
    showScreen("notifications-screen");
  }
}

function openChat(contactId) {
  activeContact = contactId;
  selectedMessageIndex = -1;
  replyTarget = null;

  const conversation = conversations.find(
    (item) => item.id === contactId
  );

  if (conversation) {
    conversation.unread = 0;
  }

  notifications = notifications.filter(
    (notification) => notification.contactId !== contactId
  );

  renderConversations();
  renderNotifications();

  const key = chatKey(
    firebaseUser.uid,
    activeContact
  );

  if (!messages[key]) {
    messages[key] = [];
  }

  renderMessages();

  markMessagesAsRead(contactId);

  showScreen("chat-screen");

  $("#message-input").focus();
}

/* =========================
   PRIVATE MESSAGES
========================= */

function sendMessage(event) {
  event.preventDefault();

  const input = $("#message-input");
  const text = input.value.trim();

  if (!text) return;

  persistPrivateMessage({
    text,
    attachment: null
  });
}

function persistPrivateMessage({ text, attachment }) {

  const time =
    new Date().toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );

  const key = chatKey(
    firebaseUser.uid,
    activeContact
  );
  const sentReply = replyTarget;

  if (!messages[key]) {
    messages[key] = [];
  }

  messages[key].push({
    from: "me",
    text,
    time,
    attachment,
    replyTo: sentReply,
    readBy: {
      [activeContact]: false
    }
  });

  $("#message-input").value = "";
  replyTarget = null;
  selectedMessageIndex = -1;

  renderMessages();
  saveMessages();

  if (database && firebaseUser) {
    const chatRef =
      database.ref("chats/" + key);

    Promise.all([
      chatRef.child("members/" + firebaseUser.uid).set(true),
      chatRef.child("members/" + activeContact).set(true)
    ])
      .then(() => chatRef.child("messages").push({
        sender: firebaseUser.uid,
        text,
        time,
        replyTo: sentReply,
        attachment,
        readBy: {
          [firebaseUser.uid]: true
        },
        createdAt: firebase.database.ServerValue.TIMESTAMP
      }))
      .catch((error) => {
        console.error("Could not send private message.", error);
      });
  }
}

function uploadPrivateAttachment(file, kind, fileName) {
  const status = $("#attachment-status");

  if (!file || !database || !firebaseUser || !activeContact) {
    if (status) status.textContent = "Open a private chat first.";
    return;
  }

  if (!storage) {
    if (status) status.textContent = "Storage is not available.";
    return;
  }

  const key = chatKey(firebaseUser.uid, activeContact);
  const name = fileName || file.name || "attachment";
  const path = "privateAttachments/" + key + "/" + Date.now() + "-" + name;
  const upload = storage.ref(path).put(file);

  if (status) status.textContent = kind === "voice" ? "Uploading voice..." : "Uploading photo...";

  upload
    .then((snapshot) => snapshot.ref.getDownloadURL())
    .then((url) => {
      persistPrivateMessage({
        text: "",
        attachment: {
          kind,
          url,
          name
        }
      });
      if (status) status.textContent = kind === "voice" ? "Voice sent." : "Photo sent.";
    })
    .catch((error) => {
      console.error("Could not upload private attachment.", error);
      if (status) status.textContent = "Upload failed. Check Firebase Storage rules.";
    });
}

function toggleVoiceRecording() {
  const button = $("#voice-button");

  if (voiceRecorder && voiceRecorder.state === "recording") {
    voiceRecorder.stop();
    button.textContent = "Voice";
    return;
  }

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    button.textContent = "Voice";
    $("#attachment-status").textContent = "Voice recording is not supported.";
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      voiceChunks = [];
      voiceRecorder = new MediaRecorder(stream);

      voiceRecorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunks.push(event.data);
      };

      voiceRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        uploadPrivateAttachment(
          new Blob(voiceChunks, { type: voiceRecorder.mimeType || "audio/webm" }),
          "voice",
          "voice-message.webm"
        );
      };

      voiceRecorder.start();
      button.textContent = "Stop";
    })
    .catch((error) => {
      console.error("Could not record voice message.", error);
      button.textContent = "Voice";
      $("#attachment-status").textContent = "Microphone permission denied.";
    });
}

function sendPublicMessage(event) {
  event.preventDefault();

  const input = $("#public-input");
  const text = input.value.trim();

  if (
    !text ||
    !database ||
    !firebaseUser
  ) {
    return;
  }

  database
    .ref("publicMessages")
    .push({
      sender: firebaseUser.uid,
      username:
        $("#current-username")
          .textContent
          .replace(/^@/, ""),
      profileImage: currentProfileImage,
      text,
      time:
        new Date().toLocaleTimeString(
          [],
          {
            hour: "2-digit",
            minute: "2-digit"
          }
        ),
      createdAt:
        firebase.database.ServerValue.TIMESTAMP
    });

  input.value = "";
}

/* =========================
   PROFILE
========================= */

function saveProfile(event) {
  event.preventDefault();

  const username =
    $("#profile-username")
      .value
      .trim();

  if (!username) return;

  const usernameLower =
    username.toLowerCase();

  const imageInput = $("#profile-image-input");
  const selectedImage = imageInput && imageInput.files[0];

  if (selectedImage && !selectedImage.type.startsWith("image/")) {
    $("#profile-status").textContent = "Please choose an image file.";
    return;
  }

  const saveProfileData = () => {
    if (selectedImage) {
      const reader = new FileReader();

      reader.onload = () => {
        localStorage.setItem(
          "qasid-profile-image-" + firebaseUser.uid,
          reader.result
        );
        $("#profile-image").src = reader.result;
        currentProfileImage = reader.result;
        database.ref("users/" + firebaseUser.uid).update({
          profileImage: reader.result
        });
      };

      reader.readAsDataURL(selectedImage);
    }
  };

  database
    .ref("users")
    .orderByChild("usernameLower")
    .equalTo(usernameLower)
    .once("value")
    .then((snapshot) => {
      let taken = false;

      snapshot.forEach((item) => {
        if (
          item.key !==
          firebaseUser.uid
        ) {
          taken = true;
        }
      });

      if (taken) {
        throw new Error(
          "Username already taken"
        );
      }

      return database
        .ref(
          "users/" +
          firebaseUser.uid
        )
        .update({
          username,
          usernameLower
        });
    })
    .then(() => {
      $("#current-username")
        .textContent =
        "@" + username;

      $("#home-username")
        .textContent =
        username;

      $("#profile-status")
        .textContent =
        "Profile saved.";

      saveProfileData();

      loadUsers();
    })
    .catch((error) => {
      $("#profile-status")
        .textContent =
        error.message;
    });
}

function saveMessages() {
  localStorage.setItem(
    "qasid-messages",
    JSON.stringify(messages)
  );
}

/* =========================
   MESSAGE LISTENER
========================= */

function listenForMessages(contactId) {
  if (!database || messageListeners.has(contactId)) return;

  messageListeners.add(contactId);

  const key = chatKey(
    firebaseUser.uid,
    contactId
  );

  database
    .ref(
      "chats/" +
      key +
      "/messages"
    )
    .limitToLast(100)
    .on("value", (snapshot) => {
      const remoteMessages = [];

      snapshot.forEach((item) => {
        const value = item.val();

        remoteMessages.push({
          id: item.key,
          sender: value.sender,
          from:
            firebaseUser &&
            value.sender ===
              firebaseUser.uid
              ? "me"
              : "them",
          text: value.text || "",
          time: value.time || "",
          replyTo: value.replyTo || null,
          attachment: value.attachment || null,
          readBy: value.readBy || {}
        });
      });

      if (remoteMessages.length) {
        messages[key] =
          remoteMessages;

        const conversation =
          conversations.find(
            (item) =>
              item.id === contactId
          );

        const latest =
          remoteMessages[
            remoteMessages.length - 1
          ];

        if (
          conversation &&
          latest
        ) {
          conversation.preview =
            messagePreview(latest);

          conversation.time =
            latest.time;

          const unreadMessages = remoteMessages.filter(
            (message) =>
              message.sender !== firebaseUser.uid &&
              !(message.readBy && message.readBy[firebaseUser.uid])
          );

          const incomingMessages = unreadMessages.filter(
            (message) => !notifiedMessageIds.has(message.id)
          );

          conversation.unread =
            activeScreen === "chat-screen" && activeContact === contactId
              ? 0
              : unreadMessages.length;

          if (incomingMessages.length && activeScreen !== "chat-screen") {
            incomingMessages.forEach((message) => {
              notifiedMessageIds.add(message.id);
              notifications.unshift({
                id: message.id,
                contactId,
                name: conversation.name,
                text: messagePreview(message),
                time: message.time
              });
            });

          }
        }

        renderConversations();
        renderNotifications();
        saveMessages();

        if (
          activeContact ===
          contactId
        ) {
          markMessagesAsRead(contactId, remoteMessages);
          renderMessages();
        }
      }
    });
}

function markMessagesAsRead(contactId, remoteMessages) {
  if (!database || !firebaseUser) return;

  const key = chatKey(firebaseUser.uid, contactId);
  const chatMessages = remoteMessages || messages[key] || [];
  const updates = {};

  chatMessages.forEach((message) => {
    if (
      message.id &&
      message.sender === contactId &&
      !(message.readBy && message.readBy[firebaseUser.uid])
    ) {
      updates["chats/" + key + "/messages/" + message.id + "/readBy/" + firebaseUser.uid] = true;
    }
  });

  if (Object.keys(updates).length) {
    database.ref().update(updates);
  }
}

/* =========================
   AUTH
========================= */

function setAuthStatus(message) {
  $("#auth-status")
    .textContent = message;
}

function updateAuthMode() {
  const isSignup =
    authMode === "signup";

  $("#auth-title")
    .textContent =
    isSignup
      ? "Create account"
      : "Qasid Login";

  $("#auth-submit")
    .textContent =
    isSignup
      ? "Create account"
      : "Login";

  $("#auth-mode")
    .textContent =
    isSignup
      ? "Back to login"
      : "Create account";

  $("#email-label")
    .style.display =
    isSignup
      ? "block"
      : "none";

  $("#email-input")
    .style.display =
    isSignup
      ? "block"
      : "none";

  $("#email-input").required =
    isSignup;

  $("#username-input")
    .placeholder =
    isSignup
      ? "Your username"
      : "Username or email";

  setAuthStatus("");
}

/* =========================
   USERS
========================= */

function updateOnlineUsers(snapshot) {
  const uniqueUsers = new Map();
  const nextPublicPresenceStates = new Map();

  snapshot.forEach((item) => {
    const user = item.val();

    if (user.publicOnline === true) {
      nextPublicPresenceStates.set(item.key, publicUserName(user));
    }

    if (
      item.key !== firebaseUser.uid &&
      user.username &&
      user.online === true
    ) {
      const normalizedUsername = usernameKey(
        user.usernameLower || user.username
      );

      if (normalizedUsername && !uniqueUsers.has(normalizedUsername)) {
        uniqueUsers.set(normalizedUsername, {
          id: item.key,
          name: user.username,
          username: user.username,
          profileImage: user.profileImage || "",
          online: true,
          preview: "No messages yet",
          time: ""
        });
      }
    }
  });

  if (publicPresenceInitialized) {
    nextPublicPresenceStates.forEach((name, uid) => {
      if (!publicPresenceStates.has(uid) && uid !== firebaseUser.uid) {
        publicPresenceEvents.push({ name, type: "joined" });
      }
    });

    publicPresenceStates.forEach((name, uid) => {
      if (!nextPublicPresenceStates.has(uid) && uid !== firebaseUser.uid) {
        publicPresenceEvents.push({ name, type: "out" });
      }
    });
  }

  publicPresenceStates.clear();
  nextPublicPresenceStates.forEach((name, uid) => {
    publicPresenceStates.set(uid, name);
  });
  publicPresenceInitialized = true;
  renderPublicPresenceEvents();

  const publicOnlineCount = $("#public-online-count");

  if (publicOnlineCount) {
    const onlineUserCount = Array.from(nextPublicPresenceStates.keys())
      .filter((uid) => uid !== firebaseUser.uid)
      .length;
    publicOnlineCount.textContent =
      "Online: " + onlineUserCount;
  }

  contacts =
    Array.from(
      uniqueUsers.values()
    );

  conversations =
    contacts.map(
      (contact) => ({
        ...contact,
        unread: conversations.find(
          (conversation) => conversation.id === contact.id
        )?.unread || 0
      })
    );

  renderConversations();

  contacts.forEach((contact) => {
    listenForMessages(contact.id);
  });
}

function loadUsers() {
  const users = database.ref("users");

  return users
    .once("value")
    .then((snapshot) => {
      updateOnlineUsers(snapshot);

      if (
        !onlineUsersListenerAttached
      ) {
        users.on(
          "value",
          updateOnlineUsers
        );

        onlineUsersListenerAttached =
          true;
      }
    });
}

function setPresence(user) {
  if (!database || !user) return;

  const connectedRef = database.ref(".info/connected");
  const userStatusRef = database.ref("users/" + user.uid + "/online");
  const publicStatusRef = database.ref("users/" + user.uid + "/publicOnline");

  connectedRef.on("value", (snapshot) => {
    if (snapshot.val() !== true) {
      return;
    }

    userStatusRef.onDisconnect().set(false);
    publicStatusRef.onDisconnect().set(false);

    userStatusRef.set(true);
    publicStatusRef.set(false);
  });
}

/* =========================
   ENTER APP
========================= */

function enterApp(user) {
  firebaseUser = user;

  welcomeStarted = false;

  setPresence(user);

  database
    .ref(
      "users/" +
      user.uid
    )
    .once("value")
    .then((snapshot) => {
      const profile =
        snapshot.val() || {};

      const username =
        profile.username ||
        user.email;

      $("#current-username")
        .textContent =
        "@" + username;

      $("#home-username")
        .textContent =
        username;

      const profileImage = $("#profile-image");

      currentProfileImage = profile.profileImage || localStorage.getItem(
        "qasid-profile-image-" + user.uid
      ) || user.photoURL || "";

      if (profileImage) {
        profileImage.src = currentProfileImage || "assets/welcome.png";
        profileImage.onerror = () => {
          profileImage.onerror = null;
          profileImage.src = "assets/welcome.png";
        };
      }

      return loadUsers();
    })
    .then(() => {
      contacts.forEach(
        (contact) => {
          listenForMessages(
            contact.id
          );
        }
      );

      listenForPublicMessages();
      listenForOwnGupShupRequests();
      listenForGupShupNotifications();

      startWelcomeScreen();
    })
    .catch(() => {
      setAuthStatus(
        "Could not load your account."
      );
    });
}

function usernameToEmail(identifier) {
  if (
    identifier.indexOf("@") ===
    -1
  ) {
    return database
      .ref("users")
      .orderByChild(
        "usernameLower"
      )
      .equalTo(
        identifier.toLowerCase()
      )
      .once("value")
      .then((snapshot) => {
        let email = null;

        snapshot.forEach(
          (item) => {
            email =
              item.val().email;
          }
        );

        if (!email) {
          throw new Error(
            "Username not found"
          );
        }

        return email;
      });
  }

  return Promise.resolve(
    identifier
  );
}

function handleAuth(event) {
  event.preventDefault();

  unlockWelcomeAudio();

  const identifier = $("#username-input").value.trim();
  const password = $("#password-input").value;
  const email = $("#email-input").value.trim();

  setAuthStatus("Please wait...");

  if (!database || !firebaseAuth) {
    setAuthStatus("Firebase is unavailable. Please try again later.");
    return;
  }

  if (authMode === "signup") {
    const username = identifier;
    const usernameLower = username.toLowerCase();

    if (!username || !email || !password) {
      setAuthStatus("Please fill all fields.");
      return;
    }

    if (username.length < 3) {
      setAuthStatus("Username must be at least 3 characters.");
      return;
    }

    if (password.length < 6) {
      setAuthStatus("Password must be at least 6 characters.");
      return;
    }

    firebaseAuth
      .createUserWithEmailAndPassword(email, password)
      .then((result) => {
        const user = result.user;

        return database
          .ref("users/" + user.uid)
          .set({
            username: username,
            usernameLower: usernameLower,
            email: user.email
          })
          .then(() => {
            return enterApp(user);
          });
      })
      .catch((error) => {
        setAuthStatus(error.message);
      });
  } else {
    usernameToEmail(identifier)
      .then((emailAddress) => {
        return firebaseAuth.signInWithEmailAndPassword(emailAddress, password);
      })
      .then((result) => {
        enterApp(result.user);
      })
      .catch((error) => {
        setAuthStatus(error.message);
      });
  }
}

function connectFirebase() {
  if (!window.firebase) return;

  try {
    const firebaseApp = firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(firebaseConfig);

    database = firebaseApp.database();

    try {
      storage = firebaseApp.storage();
    } catch (storageError) {
      storage = null;
      console.warn("Firebase Storage is unavailable.", storageError);
    }

    firebaseAuth = firebaseApp.auth();

    firebaseAuth.onAuthStateChanged((user) => {
      if (user) {
        enterApp(user);
      } else {
        welcomeStarted = false;
        clearInterval(welcomeTimer);
        stopWelcomeAudio();
        showScreen("auth-screen");
      }
    });
  } catch (error) {
    database = null;
    firebaseAuth = null;
    console.error("Could not initialize Firebase.", error);
  }
}

/* =========================
   KEYPAD NAVIGATION
========================= */

function moveFocus(direction) {
  if (activeScreen === "welcome-screen") {
    return;
  }

  if (activeScreen === "home-screen") {
    moveHomeFocus(direction);
    return;
  }

  if (
    activeScreen === "chat-screen" ||
    activeScreen === "public-screen" ||
    activeScreen === "profile-screen" ||
    activeScreen === "profile-view-screen" ||
    activeScreen === "notifications-screen"
  ) {
    return;
  }

  const list =
    activeScreen === "contacts-screen"
      ? contacts
      : conversations;

  if (!list.length) return;

  focusedIndex += direction;

  if (focusedIndex < 0) {
    focusedIndex = list.length - 1;
  }

  if (focusedIndex >= list.length) {
    focusedIndex = 0;
  }

  if (activeScreen === "contacts-screen") {
    renderContacts();
  } else {
    renderConversations();
  }

  const focused =
    document.querySelector(".is-focused");

  if (focused) {
    focused.focus();
  }
}

function selectFocused() {
  if (activeScreen === "welcome-screen") {
    const button =
      $("#lets-go-button");

    if (
      button &&
      !button.disabled &&
      button.classList.contains(
        "show-lets-go"
      )
    ) {
      finishWelcome();
    }

    return;
  }

  if (activeScreen === "profile-view-screen") {
    if (viewedContact) {
      $("#viewed-profile-message").click();
    }
    return;
  }

  if (activeScreen === "home-screen") {
    selectHomeMenu();
    return;
  }

  if (activeScreen === "contacts-screen") {
    if (
      contacts[focusedIndex]
    ) {
      openProfile(
        contacts[focusedIndex].id
      );
    }

    return;
  }

  if (activeScreen === "inbox-screen") {
    if (
      conversations[focusedIndex]
    ) {
      openChat(
        conversations[focusedIndex].id
      );
    }
  }
}

/* =========================
   BUTTON EVENTS
========================= */

$("#auth-form").addEventListener(
  "submit",
  handleAuth
);

$("#auth-mode").addEventListener(
  "click",
  () => {
    authMode =
      authMode === "login"
        ? "signup"
        : "login";

    updateAuthMode();
  }
);

$("#contacts-button").addEventListener(
  "click",
  () =>
    showScreen(
      "contacts-screen"
    )
);

$("#back-button").addEventListener(
  "click",
  () =>
    showScreen(
      "home-screen"
    )
);

$("#contacts-back-button")
  .addEventListener(
    "click",
    () =>
      showScreen(
        "home-screen"
      )
  );

$("#profile-view-back").addEventListener(
  "click",
  () => showScreen("contacts-screen")
);

$("#viewed-profile-message").addEventListener(
  "click",
  () => {
    if (viewedContact) {
      const status = gupShupStatuses.get(viewedContact.id) ||
        localStorage.getItem("qasid-gup-shup-status-" + viewedContact.id);
      const pendingIncomingRequest = [...gupShupNotifications.values()].find(
        (notification) =>
          notification.kind === "gup-shup-request" &&
          notification.senderId === viewedContact.id &&
          notification.status === "pending"
      );

      if (pendingIncomingRequest) {
        return;
      }

      if (status === "accepted") {
        openChat(viewedContact.id);
      } else if (status !== "pending") {
        sendGupShupRequest();
      }
    }
  }
);

$("#accept-gup-shup-request").addEventListener("click", () => {
  const contactId = $("#accept-gup-shup-request").dataset.contactId;
  const pendingRequest = [...gupShupNotifications.values()].find(
    (notification) =>
      notification.kind === "gup-shup-request" &&
      notification.senderId === contactId &&
      notification.status === "pending"
  );

  if (pendingRequest) {
    respondToGupShupRequest(pendingRequest, "accept");
  }
});

$("#reject-gup-shup-request").addEventListener("click", () => {
  const contactId = $("#reject-gup-shup-request").dataset.contactId;
  const pendingRequest = [...gupShupNotifications.values()].find(
    (notification) =>
      notification.kind === "gup-shup-request" &&
      notification.senderId === contactId &&
      notification.status === "pending"
  );

  if (pendingRequest) {
    respondToGupShupRequest(pendingRequest, "reject");
  }
});

$("#composer").addEventListener(
  "submit",
  sendMessage
);

$("#cancel-reply").addEventListener(
  "click",
  cancelReply
);

$("#photo-input").addEventListener(
  "change",
  (event) => {
    const file = event.target.files[0];

    if (file) {
      uploadPrivateAttachment(file, "photo");
      event.target.value = "";
    }
  }
);

$("#voice-button").addEventListener(
  "click",
  () => {
    toggleVoiceRecording();
    $("#chat-options").hidden = true;
  }
);

$("#photo-button").addEventListener(
  "click",
  () => {
    $("#photo-input").click();
    $("#chat-options").hidden = true;
  }
);

$("#left-key").addEventListener(
  "click",
  toggleChatOptions
);

$("#public-composer")
  .addEventListener(
    "submit",
    sendPublicMessage
);

$("#profile-form")
  .addEventListener(
    "submit",
    saveProfile
);

/* =========================
   LET'S GO
========================= */

$("#lets-go-button")
  .addEventListener(
    "click",
    () => {
      finishWelcome();
    }
  );

/*
  If the user touches/clicks
  the welcome screen, try to
  unlock the music.
*/
$("#welcome-screen")
  .addEventListener(
    "pointerdown",
    startWelcomeAudio,
    { passive: true }
  );

$("#welcome-screen")
  .addEventListener(
    "keydown",
    startWelcomeAudio
  );

/* =========================
   MAIN MENU BUTTONS
========================= */

document
  .querySelectorAll(
    "[data-menu]"
  )
  .forEach((button) => {
    button.addEventListener(
      "click",
      () =>
        openMenu(
          button.dataset.menu
        )
    );
  });

/* =========================
   BACK BUTTONS
========================= */

document
  .querySelectorAll(
    ".menu-back"
  )
  .forEach((button) => {
    button.addEventListener(
      "click",
      () =>
        showScreen(
          "home-screen"
        )
    );
  });

/* =========================
   LOGOUT
========================= */

function logoutUser() {
  clearInterval(
    welcomeTimer
  );

  welcomeStarted = false;

  stopWelcomeAudio();

  const markOffline =
    firebaseUser &&
    database
      ? database
          .ref(
            "users/" +
            firebaseUser.uid +
            "/online"
          )
          .set(false)
      : Promise.resolve();

  markOffline.finally(() => {
    if (firebaseAuth) {
      return firebaseAuth.signOut();
    }
    return undefined;
  });
}

$("#logout-button")
  .addEventListener(
    "click",
    logoutUser
  );

const homeLogoutButton = $("#home-logout-button");

if (homeLogoutButton) {
  homeLogoutButton.addEventListener(
    "click",
    logoutUser
  );
}

/* =========================
   KEYPAD
========================= */

document.addEventListener(
  "keydown",
  (event) => {

    /*
      WELCOME SCREEN

      OK / Enter / 0
      = Let's Go
    */
    if (
      activeScreen ===
      "welcome-screen"
    ) {
      if (
        event.key === "Enter" ||
        event.key === "OK" ||
        event.key === "Accept" ||
        event.key === "SoftCenter" ||
        event.key === "NumpadEnter" ||
        event.key === "0"
      ) {
        event.preventDefault();

        selectFocused();
        return;
      }

      return;
    }

    if (
      activeScreen === "chat-screen" &&
      (event.key === "SoftLeft" || event.key === "ContextMenu")
    ) {
      event.preventDefault();
      toggleChatOptions();
      return;
    }

    /*
      NUMBER KEYS
      HOME MENU
    */
    if (
      activeScreen ===
      "home-screen"
    ) {

      if (event.key === "1") {
        event.preventDefault();
        openMenu("public");
        return;
      }

      if (event.key === "2") {
        event.preventDefault();
        openMenu("private");
        return;
      }

      if (event.key === "3") {
        event.preventDefault();
        openMenu("profile");
        return;
      }

      if (event.key === "4") {
        event.preventDefault();
        openMenu("notifications");
        return;
      }
    }

    /*
      UP / DOWN
    */
    if (
      event.key === "ArrowDown"
    ) {
      event.preventDefault();

      if (activeScreen === "chat-screen") {
        const chatMessages = messages[chatKey(firebaseUser.uid, activeContact)] || [];

        if (chatMessages.length) {
          selectedMessageIndex = Math.min(
            selectedMessageIndex + 1,
            chatMessages.length - 1
          );
          renderMessages();
        }
        return;
      }

      moveFocus(1);
      return;
    }

    if (
      event.key === "ArrowUp"
    ) {
      event.preventDefault();

      if (activeScreen === "chat-screen") {
        const chatMessages = messages[chatKey(firebaseUser.uid, activeContact)] || [];

        if (chatMessages.length) {
          selectedMessageIndex = Math.max(
            selectedMessageIndex <= 0 ? 0 : selectedMessageIndex - 1,
            0
          );
          renderMessages();
        }
        return;
      }

      moveFocus(-1);
      return;
    }

    /*
      RIGHT / OK
      = SELECT
    */
    if (
      event.key === "ArrowRight"
    ) {
      event.preventDefault();

      if (
        activeScreen ===
          "home-screen" ||
        activeScreen ===
          "contacts-screen" ||
        activeScreen ===
          "profile-view-screen" ||
        activeScreen ===
          "inbox-screen"
      ) {
        selectFocused();
      }

      if (activeScreen === "chat-screen") {
        startReplyMode();
      }

      return;
    }

    /*
      LEFT
      = BACK
    */
    if (
      event.key === "ArrowLeft"
    ) {
      event.preventDefault();

      if (
        activeScreen ===
        "home-screen"
      ) {
        return;
      }

      if (activeScreen === "profile-view-screen") {
        showScreen("contacts-screen");
        return;
      }

      if (
        activeScreen ===
        "inbox-screen"
      ) {
        return;
      }

      showScreen(
        "home-screen"
      );

      return;
    }

    /*
      ENTER
      = SELECT
    */
    if (
      event.key === "Enter"
    ) {
      if (
        activeScreen !==
          "chat-screen" &&
        document.activeElement.tagName !==
          "BUTTON"
      ) {
        event.preventDefault();
        selectFocused();
      }

      return;
    }

    /*
      BACKSPACE / ESC
      = BACK
    */
    if (
      event.key === "Escape" ||
      event.key === "Backspace"
    ) {

      if (
        document.activeElement ===
        $("#message-input")
      ) {
        return;
      }

      event.preventDefault();

      if (
        activeScreen ===
        "home-screen"
      ) {
        return;
      }

      if (activeScreen === "profile-view-screen") {
        showScreen("contacts-screen");
        return;
      }

      if (
        activeScreen ===
        "inbox-screen"
      ) {
        return;
      }

      showScreen(
        "home-screen"
      );
    }
  }
);

/* =========================
   CLOCK
========================= */

function updateClock() {
  $("#clock").textContent =
    new Date().toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );
}

/* =========================
   SAVED MESSAGES
========================= */

const savedMessages =
  localStorage.getItem(
    "qasid-messages"
  );

if (savedMessages) {
  try {
    Object.assign(
      messages,
      JSON.parse(
        savedMessages
      )
    );
  } catch (error) {
    console.log(
      "Could not load saved messages."
    );
  }
}

/* =========================
   START APP
========================= */

updateAuthMode();
updateClock();
connectFirebase();

setInterval(
  updateClock,
  30000
);
