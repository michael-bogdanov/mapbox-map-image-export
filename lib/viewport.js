var mapboxgl = require('mapbox-gl')
var math = require('mathjs')

var LngLatBounds = mapboxgl.LngLatBounds
var Point = mapboxgl.Point
var bn = math.bignumber
var num = math.number

module.exports = function calcViewport (map, bounds, dimensions) {
  var start = Date.now()
  map.setZoom(20)
  var llb = LngLatBounds.convert(bounds)
  var dim = new Point(dimensions[0] / 2, dimensions[1] / 2)
  var nw = map.project(llb.getNorthWest())
  var se = map.project(llb.getSouthEast())
  var size = se.sub(nw)
  var scaleX = math.divide(bn(dim.x), bn(size.x))
  var scaleY = math.divide(bn(dim.y), bn(size.y))
  var scale = math.min(scaleX, scaleY)
  var transform = map.transform
  var zoom = transform.scaleZoom(num(math.multiply(transform.scale, scale)))
  var center = nw.add(se).div(2)
  var ratio = math.divide(bn(size.x), bn(size.y))
  var llne = llb.getNorthEast()
  var llsw = llb.getSouthWest()
  var widthDeg = math.subtract(bn(llsw.lng), bn(llne.lng))
  var heightDeg = math.subtract(bn(llne.lat), bn(llsw.lat))
  var padX = 0
  var padY = 0
  if (math.larger(scaleX, scaleY)) {
    padX = math.chain(heightDeg).multiply(ratio).subtract(widthDeg).divide(2).done()
  } else {
    padY = math.chain(widthDeg).divide(ratio).subtract(heightDeg).divide(2).done()
  }
  var newllne = [
    num(math.add(bn(llne.lng), padX)),
    num(math.add(bn(llne.lat), padY))
  ]
  var newllsw = [
    num(math.subtract(bn(llsw.lng), padX)),
    num(math.subtract(bn(llsw.lat), padY))
  ]

  var viewport = {
    center: map.unproject(center),
    zoom: zoom,
    bearing: 0,
    bounds: new LngLatBounds(newllsw, newllne)
  }
  console.log('calcViewport:', Date.now() - start)
  return viewport
}
