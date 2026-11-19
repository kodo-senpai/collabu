/*
 * CollabU realtime subscriptions.
 * One channel fans out every relevant table change to a single handler, which
 * the app debounces into a targeted refresh.
 */
(function () {
  let channel = null;

  const TABLES = [
    "projects",
    "project_members",
    "project_tasks",
    "project_messages",
    "project_resources",
    "applications",
    "notifications",
    "event_rsvps",
    "events",
    "connections",
    "communities",
    "community_members",
    "challenge_teams",
    "challenge_members",
    "challenge_member_days",
    "challenge_days",
    "challenge_events"
  ];

  function subscribe(handlers) {
    if (channel) unsubscribe();
    if (!window.sb) return null;

    channel = window.sb.channel("collabu-realtime", {
      config: { broadcast: { self: false } }
    });

    TABLES.forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          try {
            if (handlers && typeof handlers.onChange === "function") {
              handlers.onChange(table, payload);
            }
          } catch (err) {
            console.error("[CollabU] realtime handler failed for " + table, err);
          }
        }
      );
    });

    channel.subscribe((status) => {
      if (handlers && typeof handlers.onStatus === "function") {
        handlers.onStatus(status);
      }
    });

    return channel;
  }

  function unsubscribe() {
    if (channel && window.sb) {
      window.sb.removeChannel(channel);
    }
    channel = null;
  }

  window.Realtime = { subscribe, unsubscribe };
})();