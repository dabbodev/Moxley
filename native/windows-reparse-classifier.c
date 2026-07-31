// SPDX-License-Identifier: Apache-2.0
//
// Private production Node-API source for the Windows reparse classifier. It is
// built only by the explicit operator tool, is not wired into Moxley runtime
// traversal, and does not define a public or package-exported API.

#define WIN32_LEAN_AND_MEAN
#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif

#include <node_api.h>
#include <windows.h>

#include <stdint.h>
#include <stdlib.h>

#define MOXLEY_TEST_MAX_PATH_UTF16 32767u

static napi_value throw_napi_error(napi_env env, const char* message) {
  (void)napi_throw_error(env, NULL, message);
  return NULL;
}

static napi_value throw_type_error(napi_env env, const char* message) {
  (void)napi_throw_type_error(env, NULL, message);
  return NULL;
}

static napi_value throw_range_error(napi_env env, const char* message) {
  (void)napi_throw_range_error(env, NULL, message);
  return NULL;
}

static int set_string_property(
    napi_env env,
    napi_value object,
    const char* name,
    const char* value) {
  napi_value property_value;

  if (napi_create_string_utf8(
          env,
          value,
          NAPI_AUTO_LENGTH,
          &property_value) != napi_ok) {
    return 0;
  }

  return napi_set_named_property(
             env,
             object,
             name,
             property_value) == napi_ok;
}

static int set_uint32_property(
    napi_env env,
    napi_value object,
    const char* name,
    uint32_t value) {
  napi_value property_value;

  if (napi_create_uint32(env, value, &property_value) != napi_ok) {
    return 0;
  }

  return napi_set_named_property(
             env,
             object,
             name,
             property_value) == napi_ok;
}

static napi_value create_result(
    napi_env env,
    const char* outcome,
    uint32_t file_attributes,
    uint32_t reparse_tag,
    uint32_t win32_error,
    uint32_t close_win32_error) {
  napi_value result;

  if (napi_create_object(env, &result) != napi_ok) {
    return throw_napi_error(env, "Unable to create characterization result");
  }

  if (!set_string_property(env, result, "outcome", outcome) ||
      !set_uint32_property(
          env,
          result,
          "fileAttributes",
          file_attributes) ||
      !set_uint32_property(env, result, "reparseTag", reparse_tag) ||
      !set_uint32_property(env, result, "win32Error", win32_error) ||
      !set_uint32_property(
          env,
          result,
          "closeWin32Error",
          close_win32_error)) {
    return throw_napi_error(env, "Unable to populate characterization result");
  }

  return result;
}

static napi_value classify_path(
    napi_env env,
    napi_callback_info callback_info) {
  size_t argument_count = 2u;
  napi_value arguments[2];
  napi_valuetype argument_type;
  size_t path_length = 0u;
  size_t copied_length = 0u;
  size_t allocation_units;
  char16_t* path_buffer = NULL;
  HANDLE handle;
  DWORD open_error = ERROR_SUCCESS;
  DWORD query_error = ERROR_SUCCESS;
  DWORD close_error = ERROR_SUCCESS;
  FILE_ATTRIBUTE_TAG_INFO tag_info = {0};
  BOOL query_succeeded;
  BOOL close_succeeded;
  const char* outcome;
  size_t index;

  if (napi_get_cb_info(
          env,
          callback_info,
          &argument_count,
          arguments,
          NULL,
          NULL) != napi_ok) {
    return throw_napi_error(env, "Unable to read characterization arguments");
  }

  if (argument_count != 1u) {
    return throw_type_error(
        env,
        "Characterization requires exactly one primitive string");
  }

  if (napi_typeof(env, arguments[0], &argument_type) != napi_ok) {
    return throw_napi_error(env, "Unable to inspect characterization input");
  }

  if (argument_type != napi_string) {
    return throw_type_error(
        env,
        "Characterization input must be a primitive string");
  }

  if (napi_get_value_string_utf16(
          env,
          arguments[0],
          NULL,
          0u,
          &path_length) != napi_ok) {
    return throw_napi_error(env, "Unable to measure characterization path");
  }

  if (path_length == 0u || path_length > MOXLEY_TEST_MAX_PATH_UTF16) {
    return throw_range_error(
        env,
        "Characterization path length is outside the test bound");
  }

  if (path_length > (SIZE_MAX / sizeof(char16_t)) - 1u) {
    return throw_range_error(
        env,
        "Characterization path allocation would overflow");
  }

  allocation_units = path_length + 1u;
  path_buffer = (char16_t*)calloc(
      allocation_units,
      sizeof(char16_t));
  if (path_buffer == NULL) {
    return throw_range_error(
        env,
        "Unable to allocate characterization path");
  }

  if (napi_get_value_string_utf16(
          env,
          arguments[0],
          path_buffer,
          allocation_units,
          &copied_length) != napi_ok) {
    free(path_buffer);
    return throw_napi_error(env, "Unable to retrieve characterization path");
  }

  if (copied_length != path_length ||
      path_buffer[path_length] != (char16_t)0) {
    free(path_buffer);
    return throw_range_error(
        env,
        "Characterization path retrieval was truncated");
  }

  for (index = 0u; index < path_length; ++index) {
    if (path_buffer[index] == (char16_t)0) {
      free(path_buffer);
      return throw_type_error(
          env,
          "Characterization path contains an embedded NUL");
    }
  }

  handle = CreateFileW(
      (LPCWSTR)path_buffer,
      0,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      NULL,
      OPEN_EXISTING,
      FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
      NULL);

  if (handle == INVALID_HANDLE_VALUE) {
    open_error = GetLastError();
    free(path_buffer);
    return create_result(
        env,
        "capability-gap",
        0u,
        0u,
        (uint32_t)open_error,
        0u);
  }

  free(path_buffer);
  path_buffer = NULL;

// Characterization-only fault injection. The production build driver never
// defines MOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE.
#ifdef MOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE
  query_succeeded = FALSE;
  query_error = ERROR_GEN_FAILURE;
#else
  query_succeeded = GetFileInformationByHandleEx(
      handle,
      FileAttributeTagInfo,
      &tag_info,
      sizeof(tag_info));
  if (!query_succeeded) {
    query_error = GetLastError();
  }
#endif

  close_succeeded = CloseHandle(handle);
  if (!close_succeeded) {
    close_error = GetLastError();
  }

  if (!query_succeeded) {
    outcome = "capability-gap";
  } else if (
      (tag_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0u &&
      tag_info.ReparseTag != 0u) {
    outcome = "capability-gap";
    query_error = ERROR_INVALID_DATA;
  } else if (!close_succeeded) {
    outcome = "capability-gap";
  } else if (
      (tag_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0u) {
    outcome = "reparse";
  } else {
    outcome = "ordinary";
  }

  return create_result(
      env,
      outcome,
      (uint32_t)tag_info.FileAttributes,
      (uint32_t)tag_info.ReparseTag,
      (uint32_t)query_error,
      (uint32_t)close_error);
}

NAPI_MODULE_INIT() {
  napi_value function;

  if (napi_create_function(
          env,
          "classify",
          NAPI_AUTO_LENGTH,
          classify_path,
          NULL,
          &function) != napi_ok) {
    return throw_napi_error(env, "Unable to create characterization export");
  }

  if (napi_set_named_property(
          env,
          exports,
          "classify",
          function) != napi_ok) {
    return throw_napi_error(env, "Unable to set characterization export");
  }

  return exports;
}
