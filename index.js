/* globals mapboxgl */

var fs = require('fs')
var path = require('path')
var Qty = require('js-quantities')
var calcViewport = require('./lib/viewport')
var createGlPixelStream = require('gl-pixel-stream')
var PNGEncoder = require('png-stream/encoder')
var createFBO = require('gl-fbo')
var MultiStream = require('multistream')
var pump = require('pump')
var limit = require('./lib/limit_stream')

var argv = require('minimist')(process.argv.slice(2), {
  alias: {
    bounds: 'b',
    width: 'w',
    height: 'h',
    dpi: 'd',
    format: 'f',
    output: 'o',
    quality: 'q',
    token: 't'
  },
  default: {
    format: 'image/png',
    quality: 0.9,
    dpi: 144,
    width: '11in',
    height: '8.5in'
  },
  string: ['bounds', 'width', 'height', 'format', 'output', 'token']
})

if (!argv.t) {
  throw new Error('you must pass a valid Mapbox public token: https://www.mapbox.com/studio/account/tokens/')
}

var style = argv._[0]
var outFile = absolute(argv.output)

var pixelRatio = window.devicePixelRatio = argv.dpi / 72
var pixelWidth = parseLengthToPixels(argv.width)
var pixelHeight = parseLengthToPixels(argv.height)

var mapDiv = document.getElementById('map')

mapboxgl.accessToken = argv.token

var map = new mapboxgl.Map({
  container: 'map',
  style: style
})

var gl = map.painter.gl

var viewport = calcViewport(map, parseBounds(argv.bounds), [pixelWidth, pixelHeight])

var sections = getSections(viewport, [pixelWidth, pixelHeight], gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) * 250)
var length = sections.length

map.on('load', function () {
  var pngEncoder = new PNGEncoder(pixelWidth, pixelHeight, {colorSpace: 'rgba'})

  var ws
  if (outFile) {
    ws = fs.createWriteStream(outFile)
  } else {
    ws = process.stdout
  }

  pump(MultiStream(drawSection), pngEncoder, ws, done)
})

function drawSection (cb) {
  if (!sections.length) return cb(null, null)
  var processing = false

  var section = sections.shift()
  var fbo = createFBO(gl, section.shape, {stencil: true})
  fbo.bind()

  mapDiv.style.width = section.shape[0] / pixelRatio + 'px'
  mapDiv.style.height = section.shape[1] / pixelRatio + 'px'
  map.resize()._update()

  map.once('moveend', function () {
    map.on('render', onRender)
  })

  map.jumpTo(section.viewport)

  function onRender () {
    if (!map.animationLoop.stopped() || processing || !map.loaded()) return
    console.log('section:', length - sections.length)
    map.off('render', onRender)
    processing = true
    var glStream = createGlPixelStream(gl, fbo.handle, fbo.shape, {flipY: true})
    glStream.on('end', () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    })
    var format = {width: section.shape[0], height: section.shape[1]}
    cb(null, glStream.pipe(limit(format)))
  }
}

function parseBounds (bounds) {
  var b = bounds.split(',').map(parseFloat)
  if (b.length !== 4) throw new Error('Must pass a valid bounding box')
  return [[b[0], b[1]], [b[2], b[3]]]
}

function parseLengthToPixels (length) {
  var qty = new Qty(length)
  if (qty.isUnitless()) return length
  if (qty.kind() !== 'length') throw new Error('Invalid units')
  // Yikes, can't find method to get a unitless number back!
  // TODO: Use a better unit conversion library
  return Math.ceil(parseFloat(qty.to('in').toString()) * 72) * window.devicePixelRatio
}

function parseFormat (format) {
  switch (format) {
    case 'jpg':
    case 'jpeg':
    case 'image/jpg':
    case 'image/jpeg':
      return 'image/jpeg'
    case 'webp':
    case 'image/webp':
      return 'image/webp'
    default:
      return 'image/png'
  }
}

function getSections (viewport, dimensions, maxPixels) {
  var ne = viewport.bounds.getNorthEast()
  var sw = viewport.bounds.getSouthWest()
  var centerLng = sw.lng + (ne.lng - sw.lng) / 2
  var w = dimensions[0]
  var h = dimensions[1]
  var sectionHeight = Math.floor(maxPixels / w)
  if (h <= sectionHeight) {
    return [{
      shape: [w, h],
      viewport: viewport
    }]
  }
  var sections = Array(Math.ceil(h / sectionHeight))
  var lastHeight = h - (sectionHeight * (sections.length - 1))
  var heightDeg = ne.lat - sw.lat
  for (var i = 0; i < sections.length; i++) {
    var maxLat = ne.lat - ((heightDeg / h) * sectionHeight * i)
    var minLat = i < sections.length - 1 ? ne.lat - ((heightDeg / h) * sectionHeight * (i + 1)) : sw.lat
    var centerLat = minLat + (maxLat - minLat) / 2
    sections[i] = {
      shape: [w, i < sections.length - 1 ? sectionHeight : lastHeight],
      viewport: {
        center: [centerLng, centerLat],
        zoom: viewport.zoom
      }
    }
  }
  console.log('number of sections:', sections.length)
  return sections
}

function done (err) {
  if (err) {
    process.stderr.write(err.stack + '\n', () => process.exit(1))
  } else {
    console.log('Saved %dx%d buffer to image.png', pixelWidth, pixelHeight)
    window.close()
  }
}

function absolute (file) {
  if (!file) return null
  return path.isAbsolute(file)
    ? file
    : path.resolve(process.cwd(), file)
}
