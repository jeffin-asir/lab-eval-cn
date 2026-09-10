#!/usr/bin/env python3
import sys
import re
import json
import csv
import string
import struct


def print_c(content, status):

    print(content, " : " , end="")

    if(status == "correct"):
        print("\033[42m  Passed  \033[0m")
    else:
        print("\033[41m  Failed  \033[0m")

def print_ascii(hex_string):

    result = ""
    n = len(hex_string) // 2
    i = 0
    while (i < n):


        if (i <= n-2 and hex_string[i*2:i*2+4] == "0d0a"):

            print("\033[90m\\r\\n\033[37m", end="")
            print("\r\n", end="")
            i += 2
            continue
            
        left_nibble = hex_string[i*2]
        right_nibble= hex_string[i*2+1]
        char_byte = int(left_nibble, 16) * 16  + int(right_nibble, 16)
        
        char_byte = chr(char_byte)
        result += char_byte

        
        if   (char_byte == '\r'):
            print("\033[90m\\r\033[37m", end="")
        elif (char_byte == '\n'):
            print("\033[90m\\n\033[37m", end="")
        elif (char_byte == '\t'):
            print("\033[90m\\t\033[37m", end="")

        i += 1    
        print(char_byte, end="")
    
    return result

# Validate arguments
if len(sys.argv) != 4:
    print("Usage: python3 evaluation.py <student_id> <question_id> <testcase_id>")
    sys.exit(1)

student_id = sys.argv[1]
question_id = sys.argv[2]
testcase_id = sys.argv[3]

PRINTABLE_HEX = {format(ord(c), '02x') for c in string.printable if c not in '\r\n\t\x0b\x0c'}

# ----------- Parse Port Mappings -----------

def parse_ports():
    ip_to_logical = {}

    # Client ports
    with open("clientPorts.sh") as f:
        for line in f:
            line = line.strip()
            match = re.match(r'CLIENT_PORT\[(\d+)\]=(\d+)', line)
            if match:
                index, port = match.groups()
                ip = f"127.0.0.1.{port}"
                ip_to_logical[ip] = f"client{int(index)+1}"

    # Server ports
    with open("serverPorts.sh") as f:
        for line in f:
            line = line.strip()
            match = re.match(r'SERVER_PORT\[(\d+)\]=(\d+)', line)
            if match:
                index, port = match.groups()
                ip = f"127.0.0.1.{port}"
                ip_to_logical[ip] = f"server{int(index)+1}"

    return ip_to_logical

ip_to_logical = parse_ports()

def get_logical(ip):
    return ip_to_logical[ip]

def normalize_ip_port(ip_str):
    if ':' in ip_str:
        ip, port = ip_str.split(':')
        return f"{ip}.{port}"
    return ip_str

# ----------- Load Testcases and Extract Target One -----------
with open("testcases.json") as f:
    testcases = json.load(f)

if question_id not in testcases or testcase_id not in testcases[question_id]:
    print(f"Testcase {question_id}.{testcase_id} not found in testcases.json")
    sys.exit(1)

pairs = testcases[question_id][testcase_id]

#print(pairs)
# ----------- Parse hex_transfer.log -----------
entries = []
with open("hex_transfer.log") as f:
    print("HEX TRANSFER FILE OPENED")
    for line in f:
        line = line.strip()
        if not line:
            continue
        parts = line.split(",")
        if len(parts) != 4:
            continue
        raw_src, raw_dst, length, hex_payload = parts
        try:
            src = normalize_ip_port(raw_src.strip())
            dst = normalize_ip_port(raw_dst.strip().rstrip(":"))
        except ValueError:
            continue
        try:
            src_id = get_logical(src)
            dst_id = get_logical(dst)
        except KeyError:
            continue
        length = int(length.strip())
        payload = hex_payload.strip().replace(" ", "").lower()

        if "client" in src_id:
            direction = "c->s"
        elif "server" in src_id:
            direction = "s->c"
        else:
            continue

        entries.append((src_id, dst_id, direction, payload))
        # print(f"^{entries}^")

# ----------- Convert testcase data to HEX (old behaviour) -----------
def to_hex_variants(data):
    if isinstance(data, str):
        # Old behaviour: treat as UTF-8 string
        #print("original data: ", data)
        hex_str = data.encode('utf-8').hex()
        #print("Hex data: ", hex_str)
        return (hex_str, hex_str)
    elif isinstance(data, int):
        return (
            struct.pack('>i', data).hex(),
            struct.pack('<i', data).hex()
        )
    elif isinstance(data, float):
        return (
            struct.pack('>d', data).hex(),
            struct.pack('<d', data).hex()
        )
    elif isinstance(data, bool):
        return (
            struct.pack('>i', 1 if data else 0).hex(),
            struct.pack('<i', 1 if data else 0).hex()
        )
    else:
        raise TypeError(f"Unsupported data type: {type(data)}")

# ----------- New: compare hex with read/skip pattern -----------

def compare_hex_with_pattern(actual_hex, expected_hex, pattern):
    """
    actual_hex   : hex string (no 0x, no spaces, lowercase)
    expected_hex : hex string (no 0x, no spaces, lowercase)
    pattern      : list of ints, e.g. [5, -5, 4]

    Positive n  -> compare next n bytes.
    Negative -n -> skip next n bytes.
    """
    byte_pos = 0  # in bytes, not characters

    for p in pattern:
        if p == 0:
            # Should not normally appear here (0 is reserved for "use old behaviour")
            continue

        n = abs(p)
        start = byte_pos * 2
        end = (byte_pos + n) * 2

        # Not enough bytes in either expected or actual -> mismatch
        if len(actual_hex) < end or len(expected_hex) < end:
            return False

        if p > 0:
            # Must match exactly for this chunk
            if actual_hex[start:end] != expected_hex[start:end]:
                #diff_print.compare_hex_patterns(expected_hex, actual_hex, pattern)
                
                print("\033[31m-");print_ascii(actual_hex[start:end]);print("\033[0m");
                print("\033[33m+");print_ascii(expected_hex[start:end]);print("\033[0m");
                return False

        # Move past these bytes (read or skipped)
        byte_pos += n

        print("\033[32m⋅");print_ascii(actual_hex[start:end]);print("\033[0m");
    # Trailing bytes are ignored; only pattern-covered region matters
    return True

# ----------- Evaluation Logic -----------
row = [student_id, f"{question_id}.{testcase_id}"]
obtained_list = []
passed_list   = []

# Initialize dynamic columns (2 per communication)
for _ in pairs:
    row.append("fail")
    row.append("wrong")


pair_count = 0
for idx, item in enumerate(pairs):
    # Determine pattern (read/skip list) and communication dict
    # Supported forms:
    #   1) { "client1_to_server1": value }              -> pattern = [0]
    #   2) [[0], { "client1_to_server1": value }]       -> pattern = [0]
    #   3) [[5,-5], { "client1_to_server1": "0x..." }]  -> pattern = [5,-5]
    pattern = [0]
    comm = None
    pair_count += 1
    
    if isinstance(item, dict):
        comm = item
    elif isinstance(item, list) and len(item) == 2 and isinstance(item[0], list) and isinstance(item[1], dict):
        pattern, comm = item
    else:
        print(item)
        print(f"Invalid testcase entry at index {idx}: {item}")
        continue

    if len(comm) != 1:
        print(f"Invalid communication entry in testcase: {comm}")
        continue

    key, expected_data = next(iter(comm.items()))
    src_logical, dst_logical = key.split("_to_")
    direction = "c->s" if "client" in src_logical else "s->c"
    matched_pair = False

    try:
        hex_big, hex_little = to_hex_variants(expected_data)
    except Exception as e:
        print(f"Hex conversion failed for data {expected_data}: {e}")
        continue
    
    for e_src, e_dst, e_dir, e_data in entries:

        print("\nCHECKING: ")
        print_ascii(e_data.lower())
        print("\n")
        if e_dir == direction and e_src == src_logical and e_dst == dst_logical:
            actual = e_data.lower() # here actual represents the data from the hex_transfer.log
            matched = False
            obtained_list.append(actual)
            
            # --------- CASE 1: pattern [0] -> old behaviour (int/float/double/string/etc.) ---------
            if pattern == [0]:                
                if isinstance(expected_data, (int, float, bool)):
                    matched = (actual == hex_big) or (actual == hex_little)
                elif isinstance(expected_data, str):                # here expected_data is from the testcase.json
                    # Guided testcase creation stores every payload as a raw
                    # hexadecimal literal, including ordinary strings.  [0]
                    # means the full captured payload must match that value.
                    # Keep the legacy UTF-8 string behaviour below for old
                    # questions saved before the guided builder existed.
                    if expected_data.startswith(("0x", "0X")):
                        # print("obtained :"); print(actual)
                        expected_hex = expected_data[2:].replace(" ", "").lower()
                        # print("expected :", end="");print(expected_hex)
                        expected_little = bytes.fromhex(expected_hex)[::-1].hex()
                        matched = (
                            actual.startswith(expected_hex) or
                            actual.endswith(expected_hex) or
                            actual.startswith(expected_little) or
                            actual.endswith(expected_little)
                        )
                    else:
                        # Original "string with printable-next-byte" heuristic
                        print("")
                        if actual.startswith(hex_big):
                            next_index = len(hex_big)
                            if next_index + 2 <= len(actual):
                                next_byte = actual[next_index:next_index+2]
                                if next_byte in PRINTABLE_HEX:
                                    matched = False
                                else:
                                    matched = True
                            else:
                                matched = True
                        elif actual.startswith(hex_little):
                            next_index = len(hex_little)
                            if next_index + 2 <= len(actual):
                                next_byte = actual[next_index:next_index+2]
                                if next_byte in PRINTABLE_HEX:
                                    matched = False
                                else:
                                    matched = True
                            else:
                                matched = True

            # --------- CASE 2: pattern with reads/skips -> struct/array hex path ---------
            else:
                # For struct/array checks we expect a raw hex literal like "0x68656C6C6F0000000000"
                if isinstance(expected_data, str) and expected_data.startswith(("0x", "0X")):
                    print("obtained :"); print_ascii(actual)
                    expected_hex = expected_data[2:].replace(" ", "").lower()
                    print("expected :", end="");print_ascii(expected_hex)

                    
                    matched = compare_hex_with_pattern(actual, expected_hex, pattern)
                else:
                    print(f"Pattern {pattern} used with non-hex data {expected_data}; "
                          f"expected a string like '0x...'")
                    matched = False



                
            # Mark that we at least saw the packet
            row[2 + 2*idx] = "ok"
            if matched:
                row[2 + 2*idx + 1] = "correct"
                print_c(testcase_id+"."+str(pair_count), "correct")
                matched_pair = True
                passed_list.append(actual)
                obtained_list = []
                break

    if not matched :

        for obj in obtained_list:

            if obj in passed_list:
                continue
            print("\033[33mOBTAINED :\033[0m"); print_ascii(obj)
            if (obj == "" ):
                print("GOT EMPTY")
            print("\n")
            print("HEX :"); print(obj)
            
        print("\033[36mEXPECTED :\033[0m");
        if isinstance(expected_data, str) and expected_data.startswith(("0x", "0X")):
            expected_hex = expected_data[2:].replace(" ", "").lower()
            print_ascii(expected_hex)
            print("HEX :");print(expected_hex)

        else:
            print(expected_data)
        print("\n")

        print_c(testcase_id+"."+str(pair_count), "wrong")
        obtained_list = []


# ----------- Append to evaluated.csv -----------
eval_file = f"{student_id}_evaluated.csv"

with open(eval_file, "a", newline="") as f:
    
    writer = csv.writer(f)
    writer.writerow(row)

#print(f"Appended result for {question_id}.{testcase_id} to {eval_file}")
