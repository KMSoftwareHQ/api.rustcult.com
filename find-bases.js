let d3 = import('d3-quadtree');
const db = require('./database');

function CountNeighbors(tree, x, y, r) {
    const rSquared = r * r;
    const xmin = x - r;
    const ymin = y - r;
    const xmax = x + r;
    const ymax = y + r;
    let count = 0;
    tree.visit((node, x1, y1, x2, y2) => {
	if (!node.length) {
	    do {
		let d = node.data;
		if (d[0] >= xmin && d[0] < xmax && d[1] >= ymin && d[1] < ymax) {
		    const dx = x - d[0];
		    const dy = y - d[1];
		    const distanceSquared = dx * dx + dy * dy;
		    if (distanceSquared < rSquared) {
			count++;
		    }
		}
	    } while (node = node.next);
	}
	return x1 >= xmax || y1 >= ymax || x2 < xmin || y2 < ymin;
    });
    return count;
}

function IsCloseToAny(p, neighbors, radius) {
    const r2 = radius * radius;
    for (const n of neighbors) {
	const dx = n[0] - p.x;
	const dy = n[1] - p.y;
	const d2 = dx * dx + dy * dy;
	if (d2 < r2) {
	    return true;
	}
    }
    return false;
}

function FindDensestPointExcludingCircles(points, centers, exclusionRadius) {
    const tree = d3.quadtree();
    for (const p of points) {
	if (!IsCloseToAny(p, centers, exclusionRadius)) {
	    tree.add([p.x, p.y]);
	}
    }
    let maxNeighbors = -1;
    let densestX;
    let densestY;
    const searchRadius = 3;
    for (const p of points) {
	if (IsCloseToAny(p, centers, exclusionRadius)) {
	    continue;
	}
	const neighborCount = CountNeighbors(tree, p.x, p.y, searchRadius);
	if (neighborCount > maxNeighbors) {
	    maxNeighbors = neighborCount;
	    densestX = p.x;
	    densestY = p.y;
	}
    }
    return [densestX, densestY, maxNeighbors];
}

async function FindBases(serverIncrementingId, userIncrementingId) {
    // Initialize d3 if it isn't already.
    d3 = await d3;
    const points = await db.Query(
	'SELECT x, y FROM player_positions ' +
	'WHERE user_incrementing_id = ? AND server_incrementing_id = ?',
	[userIncrementingId, serverIncrementingId],
    );
    const bases = [];
    const n = points.length;
    if (n < 500) {
	// Not enough points to confidently identify bases. Bail.
	return bases;
    }
    while (true) {
	const base = FindDensestPointExcludingCircles(points, bases, 30);
	if (!base) {
	    break;
	}
	const x = base[0];
	if (!x) {
	    break;
	}
	const y = base[1];
	const neighborCount = base[2];
	const density = neighborCount / points.length;
	const percent = (100 * density).toFixed(3);
	if (density < 0.03) {
	    break;
	}
	bases.push(base);
    }
    return bases;
}

module.exports = {
    FindBases,
};
