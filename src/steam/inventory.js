import axios from 'axios';

export const TARGET_APPS = [
  { appid: 730, name: 'Counter‑Strike 2' },
  { appid: 252490, name: 'Rust' },
  { appid: 570, name: 'Dota 2' },
  { appid: 440, name: 'Team Fortress 2' }
];

export const TARGET_APP_IDS = TARGET_APPS.map((g) => g.appid);

function buildSteamIconUrl(iconUrl) {
  return `https://community.akamai.steamstatic.com/economy/image/${iconUrl}`;
}

export async function fetchTargetInventories(steamid, ownedAppIds) {
  const debugMode = process.env.VITE_DEBUG_MODE === 'true';
  const ownedSet = new Set(ownedAppIds);

  const inventories = {};
  let ownsAnyTarget = false;

  for (const game of TARGET_APPS) {
    let owned = ownedSet.has(game.appid);
    if (owned) {
      ownsAnyTarget = true;
    }

    const result = {
      appid: game.appid,
      gameName: game.name,
      owned,
      items: []
    };

    if (debugMode) {
      ownsAnyTarget = true;
      result.owned = true;

      const baseName =
        game.appid === 730 ? 'Mock Dragon Lore' : `Mock Skin – ${game.name}`;

      const mockItems = [];
      for (let i = 1; i <= 8; i += 1) {
        mockItems.push({
          name: `${baseName} #${i}`,
          description: `Factory New\nAppID: ${game.appid}\nDebug mock skin #${i} (no live Steam data).`,
          iconUrl: '/assets/test-skin.png',
          isMock: true,
          mockIndex: i
        });
      }
      result.items = mockItems;

      inventories[game.appid] = result;
      continue;
    }

    if (owned) {
      try {
        const url = `https://steamcommunity.com/inventory/${steamid}/${game.appid}/2`;
        const response = await axios.get(url, {
          params: {
            l: 'english',
            count: 75
          }
        });

        const data = response.data || {};
        const descriptions = Array.isArray(data.descriptions) ? data.descriptions : [];

        result.items = descriptions
          .filter((d) => d && d.icon_url && Array.isArray(d.descriptions) && d.descriptions.length > 0)
          .map((d) => ({
            name: d.name,
            description: d.descriptions
              .map((p) => p.value || p.text || '')
              .filter(Boolean)
              .join('\n'),
            iconUrl: buildSteamIconUrl(d.icon_url)
          }));
      } catch (err) {
        // Treat failures as empty / private inventory for this game.
        result.items = [];
      }
    }

    inventories[game.appid] = result;
  }

  return { inventories, ownsAnyTarget };
}

