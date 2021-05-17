#!/bin/sh

set -eux

file="${1}"
shift

until [ -s "${file}" ]; do
  >&2 echo "${file} is empty. Sleeping..."
  sleep 1
done

export $(cat "${file}" | sed 's/#.*//g' | sed 's/\r//g' | xargs)

exec "${@}"
