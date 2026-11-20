/*
 * CollabU SVG icon set.
 * Usage: icon('building', 'w-4 h-4') -> inline SVG string.
 * No emoji icons; all icons inherit currentColor.
 */
(function () {
  const paths = {
    building: '<path d="M4 21V8l8-4 8 4v13"/><path d="M9 21v-5h6v5"/>',
    cap: '<path d="M3 9l9-4 9 4-9 4-9-4z"/><path d="M7 12v5c0 1.5 4.5 3 9 3s9-1.5 9-3v-5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    rocket: '<path d="M4.5 16.5c1.5 1.5 3.5 1.5 5 0L21 5l-3-3-11.5 11.5c-1.5 1.5-1.5 3.5 0 5z"/><path d="M15 9l-3-3"/><path d="M9 15l-3-3"/>',
    robot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="2" r="1"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
    palette: '<path d="M12 2a10 10 0 1 0 0 20c1.5 0 2-1 2-2s-.5-2-2-2h-1c-1 0-2-1-2-2s1-2 2-2h4a5 5 0 0 0 5-5c0-4-4-7-10-7z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/>',
    flame: '<path d="M12 2c1 4-2 5-2 8 0 1.5 1 2.5 2 2.5S14 11.5 14 10c2 2 3 4 3 6a5 5 0 0 1-10 0c0-4 3-6 5-14z"/>',
    sparkle: '<path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
    check: '<path d="M5 12l4 4L19 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    medal: '<circle cx="12" cy="15" r="6"/><path d="M12 2l3 6H9l3-6z"/><path d="M9 21l3-2 3 2"/>',
    paperclip: '<path d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3 3 0 0 1 4 4l-9 9a1 1 0 0 1-2-2l8-8"/>',
    trophy: '<path d="M8 3h8v5a4 4 0 0 1-8 0V3z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3"/><path d="M12 12v5"/><path d="M9 21h6"/><path d="M10 17h4v4h-4z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2-2 2.1-2.1z"/>'
  };

  function icon(name, cls) {
    const path = paths[name];
    if (!path) return "";
    return `<svg class="${cls || "w-4 h-4"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }

  window.icon = icon;
})();