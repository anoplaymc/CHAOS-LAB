/** Built-in events. The table a handler receives has exactly these fields. */
export const EVENT_NAMES: Record<string, { fields: string; doc: string }> = {
  tick: { fields: 'dt', doc: 'Every physics step, 60 times a second. Keep it short, or use timer.every.' },
  session_start: { fields: 'map, mode', doc: 'A world has been built and play is starting. Also fires after a restart.' },
  session_end: { fields: '(none)', doc: 'The world is about to be torn down. Timers are cancelled and panels removed.' },
  entity_spawned: { fields: 'id, def', doc: 'An entity appeared during play. Map props placed while a session starts don\'t fire this.' },
  entity_removed: { fields: 'id, def', doc: 'An entity is gone, for any reason. Its id is already invalid.' },
  entity_damaged: { fields: 'id, def, amount, source, attacker', doc: 'source is "player", "npc", "impact", "explosion" or "other". attacker is the entity responsible, if an entity was, and is absent otherwise.' },
  entity_broken: { fields: 'id, def', doc: 'A breakable prop\'s health reached zero, just before removal.' },
  entity_used: { fields: 'id, def', doc: 'The player pressed E on it.' },
  npc_killed: { fields: 'id, def, by_player', doc: 'An NPC died. Its id still works during the handler. by_player is also true for an explosion with no entity behind it, such as a barrel.' },
  player_damaged: { fields: 'amount, source, attacker', doc: 'The player took damage. attacker is the entity responsible, if an entity was. source is "npc", "explosion", "impact", "fall", "blast", "player", "other", or "mod:<id>" from player.damage.' },
  player_died: { fields: '(none)', doc: 'The player died.' },
  explosion: { fields: 'position, radius', doc: 'An explosion happened, from any cause.' },
  tool_selected: { fields: 'id', doc: 'The player switched tools.' },
};
