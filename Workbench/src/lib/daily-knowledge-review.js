function snapshotOf(event) {
  return event?.workItem && typeof event.workItem === "object" ? event.workItem : null;
}

function latestByWorkItem(events) {
  const map = new Map();
  for (const event of events) {
    if (!event?.workItemId) continue;
    const previous = map.get(event.workItemId);
    if (!previous || Date.parse(event.at || "") >= Date.parse(previous.at || "")) {
      map.set(event.workItemId, event);
    }
  }
  return map;
}

function focusCount(focusHistory, workItemId) {
  return focusHistory.filter((entry) => entry.workItemId === workItemId).length;
}

function reviewItem(event, focusHistory, activeCandidateIds) {
  const workItem = snapshotOf(event);
  return {
    workItemId: event.workItemId,
    title: workItem?.title || event.workItemId,
    kind: workItem?.kind || null,
    source: workItem?.source || null,
    outcome: event.outcome || "active",
    at: event.at,
    focusSessions: focusCount(focusHistory, event.workItemId),
    stillCandidate: activeCandidateIds.has(event.workItemId),
  };
}

export function buildDailyKnowledgeReview(state, candidates = []) {
  const events = Array.isArray(state?.events) ? state.events : [];
  const focusHistory = Array.isArray(state?.focusHistory) ? state.focusHistory : [];
  const activeCandidates = Array.isArray(candidates) ? candidates : [];
  const activeCandidateIds = new Set(activeCandidates.map((item) => item.id));
  const latestEvents = latestByWorkItem(events);
  const touched = [...latestEvents.values()]
    .map((event) => reviewItem(event, focusHistory, activeCandidateIds))
    .sort((left, right) => Date.parse(right.at || "") - Date.parse(left.at || ""));

  const completed = touched.filter((item) => item.outcome === "completed");
  const verifiedChanges = completed.filter((item) => !item.stillCandidate && item.source);
  const unverifiedCompletions = completed.filter((item) => item.stillCandidate || !item.source);
  const deferred = touched.filter((item) => item.outcome === "later");
  const skipped = touched.filter((item) => item.outcome === "skipped");
  const activeTouched = touched.filter((item) => item.outcome === "active");
  const untouchedCandidates = activeCandidates
    .filter((candidate) => !latestEvents.has(candidate.id))
    .map((candidate) => ({
      workItemId: candidate.id,
      title: candidate.title,
      kind: candidate.kind,
      source: candidate.source,
      outcome: "active",
      at: null,
      focusSessions: 0,
      stillCandidate: true,
    }));

  return {
    date: state?.date ?? null,
    stats: {
      touched: touched.length,
      focusSessions: focusHistory.length,
      completed: completed.length,
      verifiedChanges: verifiedChanges.length,
      remaining: deferred.length + skipped.length + activeTouched.length + untouchedCandidates.length,
    },
    verifiedChanges,
    unverifiedCompletions,
    deferred,
    skipped,
    active: [...activeTouched, ...untouchedCandidates],
    rawEvents: events,
    note: state?.review?.note ?? "",
    noteUpdatedAt: state?.review?.updatedAt ?? null,
  };
}
