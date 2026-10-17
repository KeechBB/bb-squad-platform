export type ReplaySample = { t: number; x: number; y: number; z?: number };

export type ReplayTrack = {
  key: string;
  samples: ReplaySample[];
};

export type ReplayPayload = {
  id: string;
  title?: string;
  layer: string;
  mapKey?: string;
  map_name?: string;
  duration_ms: number;
  squad_version?: string;
  server?: string;
  recordedAt?: string;
  players: Array<{
    name?: string | null;
    steam_id?: string | null;
    eos_id?: string | null;
    team_id?: number | null;
    faction?: string | null;
    squad_id?: number | null;
  }>;
  tracks: {
    players: ReplayTrack[];
    vehicles: ReplayTrack[];
  };
  events: {
    kills: Array<Record<string, unknown>>;
    deployments: Array<Record<string, unknown>>;
  };
  teams?: Array<Record<string, unknown>>;
};

export type ReplayIndexEntry = {
  id: string;
  title: string;
  layer: string;
  mapKey: string;
  duration_ms: number;
  server?: string;
  recordedAt?: string;
  tracks_players: number;
  players: string[];
};

export type ReplayIndex = {
  version: number;
  matches: ReplayIndexEntry[];
};
