#!/bin/bash



	Qi=$1		# QUESTION NUMBER
	PROTOCOL=$2	# PROTOCOL like tcp, udp
	
        > meta_${Qi}.log
        > ack_${Qi}.log
        > data_${Qi}.log
        > dhead_${Qi}.log
	> hex_transfer.log
	> flags.log

	#printf "\nprotocol $PROTOCOL\n\n"

	hcount=0
        length=0
        previous_line=""
        previous_meta=""

	net_hex=""

        REGEX_tcp='IP.*Flags.*win.*length\ [0-9]+'
        REGEX_udp='IP.* > .*UDP, length\ [0-9]+'

        protocol_regex="REGEX_$PROTOCOL"

        #printf "regex name $protocol_regex"
        #printf "regex->${!protocol_regex}"

        while IFS= read -r line;
        do
                if [[ $line =~ ${!protocol_regex} ]];then
                          echo $line >> meta_${Qi}.log

			if [[ "$PROTOCOL" == "tcp" ]];then
				 	echo "$line" | awk '{print $3,$5,$7}' >> flags.log
			fi


			if [[ "$PROTOCOL" == "tcp" ]];then

                                ### this operation need to be performed only during the
                                ### TCP protocol.
                                  echo "$line" | awk '{print $3,$5,$7}' >> flags.log
                        fi

			#printf "|||${line}|||\n"
                        if [[ "$length" == "0" ]];then
                                #printf "GOT LENGTH 0"
                                length="$(echo $line | awk '{print $NF}')"
                                previous_meta=$line
				if [[  $previous_line == "" ]];then
                                        continue
                                fi

				#printf "current line |||$previous_line|||"
                                 	echo "$previous_line" >> ack_${Qi}.log
		 		previous_line=""
		 		continue
                        fi

			net_hex=""

			while IFS= read -r single_hex_line;
			do
				if [[ "$single_hex_line" == "" ]];then
					continue
				fi
				#printf -n "||$single_hex_line||"
				read -r -a seg <<< "$single_hex_line"
					
				hcount=0
				for hex_word in "${seg[@]}";
				do
					if [[ $hcount -eq 0  ]];then
						((hcount++))
						continue
					fi

					net_hex+="$hex_word"
					((hcount++))		
				done
					
			done <<< "$previous_line"

			echo "$net_hex" >> hex.log

			size=${#net_hex}
			data=${net_hex:$((size-(2*length)))}

			tfrom=$(  echo "$previous_meta" | awk '{print $3}')
			tto=$(  echo "$previous_meta" | awk '{print $5}')


                        echo "${tfrom},${tto},${length},$data" >> hex_transfer.log
                        echo "$previous_meta" >> dhead_${Qi}.log
			echo "$previous_line" >> ack_${Qi}.log
                        length="$(  echo $line | awk '{print $NF}')"

			net_hex=""
        	        previous_line=""              
			previous_meta=$line
			continue
                fi

                previous_line+=$line
                previous_line+=$'\n'

		#printf "current line |||$previous_line|||"
        done < transfer.hex



	if [[ "$length" == "0" ]];then
		 	echo "$previous_line" >> ack_${Qi}.log
	else

		net_hex=""
while IFS= read -r single_hex_line;
do
	if [[ "$single_hex_line" == "" ]];then
		continue
	fi
	#printf -n "||$single_hex_line||"
	read -r -a seg <<< "$single_hex_line"
 
	hcount=0
	for hex_word in "${seg[@]}";
	do
		if [[ $hcount -eq 0  ]];then
			 ((hcount++))
                         continue
		fi
		net_hex+="$hex_word"
		#printf "(net hex)<<<$net_hex >>>(net hex)\n"
		((hcount++))
	done
 
done <<< "$previous_line"
		
		size=${#net_hex}
                data=${net_hex:$((size-(2*length)))}
		
                tfrom=$(  echo "$previous_meta" | awk '{print $3}')
		tto=$(  echo "$previous_meta" | awk '{print $5}')

		  echo "$previous_line" >> ack_${Qi}.log
                  echo "${tfrom},${tto},${length},$data" >> hex_transfer.log
		  echo "$previous_line" >> ack_${Qi}.log
               	  echo "$previous_meta" >> dhead_${Qi}.log
                  echo "$data" >> data_${Qi}.log
	fi

