'use strict';

function isTimerEvent(event = {}) {
  const type = String(event.Type || event.type || event.triggerType || '').trim().toLowerCase();
  if (type) return type === 'timer' || type === 'timed' || type === 'schedule';
  return Boolean(
    (event.TriggerName || event.triggerName) &&
    !event.httpMethod &&
    !event.path &&
    !event.rawPath &&
    !event.requestContext?.http
  );
}

function timerNameOf(event = {}) {
  return String(event.TriggerName || event.triggerName || '').trim();
}

module.exports = { isTimerEvent, timerNameOf };
