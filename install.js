#!/usr/bin/env node


# asd

var slug = process.argv[2];
var rev = process.argv[3];
var writeLatest = (process.argv[4]) ? true : false;

var path = require('path');