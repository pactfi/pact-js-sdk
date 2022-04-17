#!/bin/bash

set -e

remoteUrl=$(git remote get-url origin);
version=$(git describe --tags);

git clone $remoteUrl -b gh-pages gh-pages

npm run docs

mv docs "gh-pages/$version"

cd gh-pages

ln -s "$version" latest

git add -A
git commit -m "Updated docs for $version"
git push origin gh-pages
