#!/bin/bash

set -e

remoteUrl=$(git remote get-url origin);
version=$(git describe --tags);

npm run docs

mv docs "gh-pages/$version"

cd gh-pages

rm latest
ln -s "$version" latest

git add -A
git commit -m "Updated docs for $version"
git push origin gh-pages
