// This script takes a series of images rendered with different levels of exposure,
// and combines them into a single master image.

const { createCanvas, createImageData, loadImage } = require('canvas');
const fs = require('fs');

const imageSeriesName = 'pickle-zerg';
const highestAlpha = 50;

async function LoadImageData(filename) {
    const image = await loadImage(filename);
    const w = image.width;
    const h = image.height;
    const canvas = createCanvas(w, h);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, w, h);
    const imageData = context.getImageData(0, 0, w, h);
    const pix = imageData.data;
    return [pix, w, h];
}

function SaveImageData(data, w, h, filename) {
    const imageData = createImageData(data, w, h);
    const canvas = createCanvas(w, h);
    const context = canvas.getContext('2d');
    context.putImageData(imageData, 0, 0);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filename, buffer);
}

function FindNonBlackPixels(pix) {
    const nonBlackPixels = [];
    for (let i = 0; i < pix.length; i += 4) {
	const r = pix[i];
	const g = pix[i + 1];
	const b = pix[i + 2];
	if (r > 0 || g > 0 || b > 0) {
	    nonBlackPixels.push(i);
	}
    }
    return nonBlackPixels;
}

function SetPixel(data, i, r, g, b) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
}

async function UpdateTargetPixels(targetPixels, alpha, masterImage) {
    const newTargetPixels = [];
    const [pix, w, h] = await LoadImageData(`${imageSeriesName}-${alpha}.png`);
    for (const i of targetPixels) {
	const r = pix[i];
	const g = pix[i + 1];
	const b = pix[i + 2];
	if (r < 255 && g < 255 && b < 255) {
	    // SetPixel(masterImage, i, r, g, b);
	} else {
	    SetPixel(masterImage, i, r, g, b);
	    newTargetPixels.push(i);
	}
    }
    return newTargetPixels;
}

async function Main() {
    const [masterImage, w, h] = await LoadImageData(`${imageSeriesName}-${highestAlpha}.png`);
    let targetPixels = FindNonBlackPixels(masterImage);
    for (let alpha = highestAlpha; alpha >= 0; alpha--) {
	console.log('alpha', alpha, 'pixels left', targetPixels.length);
	targetPixels = await UpdateTargetPixels(targetPixels, alpha, masterImage);
    }
    SaveImageData(masterImage, w, h, 'test.png');
}

Main();
