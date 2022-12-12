
function DistanceBetweenBases(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function GeometricMedian(bases) {
    const n = bases.length;
    let minDistance;
    let median;
    for (let i = 0; i < n; i++) {
	let totalDistance = 0;
	for (let j = 0; j < n; j++) {
	    totalDistance += DistanceBetweenBases(bases[i], bases[j]);
	}
	if (!minDistance || totalDistance < minDistance) {
	    minDistance = totalDistance;
	    median = bases[i];
	}
    }
    return median;
}

function CombineClusters(a, b) {
    const residents = a.residents.concat(b.residents);
    const playerBases = a.playerBases.concat(b.playerBases);
    const median = GeometricMedian(playerBases);
    return {
	residents,
	playerBases,
	x: median.x,
	y: median.y,
	mainBase: a.mainBase || b.mainBase,
    };
}

function FullLinkageClusterDistance(a, b) {
    let maxDistance = 0;
    for (let i = 0; i < a.playerBases.length; i++) {
	for (let j = 0; j < b.playerBases.length; j++) {
	    const distance = DistanceBetweenBases(a.playerBases[i], b.playerBases[j]);
	    maxDistance = Math.max(distance, maxDistance);
	}
    }
    return maxDistance;
}

function FindClosestClusters(clusters) {
    const n = clusters.length;
    let bestI;
    let bestJ;
    let bestDistance;
    for (let i = 0; i < n; i++) {
	for (let j = i + 1; j < n; j++) {
	    const distance = FullLinkageClusterDistance(clusters[i], clusters[j]);
	    if (!bestDistance || distance < bestDistance) {
		bestDistance = distance;
		bestI = i;
		bestJ = j;
	    }
	}
    }
    return [bestI, bestJ, bestDistance];
}

function Cluster(playerBases) {
    const groupBases = [];
    for (const base of playerBases) {
	groupBases.push({
	    residents: [base.userIncrementingId],
	    playerBases: [base],
	    x: base.x,
	    y: base.y,
	    mainBase: base.mainBase,
	});
    }
    const maxClusterWidth = 27;
    while (true) {
	const [i, j, distance] = FindClosestClusters(groupBases);
	//console.log(`Closest clusters ${i} and ${j} with distance ${distance}`);
	if (distance === undefined || distance === null) {
	    break;
	}
	if (distance > maxClusterWidth) {
	    break;
	}
	//console.log('Merging');
	const newCluster = CombineClusters(groupBases[i], groupBases[j]);
	groupBases.splice(j, 1);
	groupBases.splice(i, 1);
	groupBases.push(newCluster);
    }
    return groupBases;
}

module.exports = {
    Cluster,
};
