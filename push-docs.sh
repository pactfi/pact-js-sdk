#!/bin/bash

remoteUrl=$(git remote get-url origin);
version=$(git describe --tags);

npm run docs

mv docs "gh-pages/$version"

cd gh-pages

ln -s "$version" latest
git add -A
git commit -m "Added docs for $version"
git push origin gh-pages
