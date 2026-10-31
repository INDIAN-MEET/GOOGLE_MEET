/**
 * src/components/VideoGrid.tsx
 * -------------------------------------------------------------
 * Reads the call store and draws all tiles. CSS (.grid) does the layout.
 */
import { useCallStore } from '../call/callStore';
import { VideoTile } from './VideoTile';

export function VideoGrid({ camOn }: { camOn: boolean }) {
  // STEP 1 — subscribe ONLY to what we draw
  const local = useCallStore((s) => s.local);
  const peers = useCallStore((s) => s.peers);

  return (
    <div className="grid">
      {/* STEP 2 — our own tile: muted + mirrored */}
      <VideoTile stream={local} name="You" muted mirror videoOff={!camOn} />

      {/* STEP 3 — one tile per remote person, + one per screen share */}
      {Object.values(peers).flatMap((p) => {
        const name = p.name ?? `Guest ${p.userId.slice(0, 4)}`;
        const tiles = [<VideoTile key={p.userId} stream={p.cam} name={name} />];
        if (p.screen) {
          tiles.push(<VideoTile key={`${p.userId}:screen`} stream={p.screen} name={`${name} (screen)`} />);
        }
        return tiles;
      })}
    </div>
  );
}
