// Package deps —— the running things the composition root holds: connection pools,
// each domain's repos, both axis registries, and the two convergence points.
//
// **Data only, no assembly** — constructing these objects is main's job; this package
// only gives them a shared type, so the composition root's four groups (port / axisconn /
// axiscap / wire) can all hold the same reference.
//
// It is a leaf inside the composition root: none of those four packages import it.
// That's what makes the direction hold — once everything is flattened into one package,
// any section could reach any other section directly.
package deps
